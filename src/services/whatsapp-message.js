import { responderComRAG } from "./ai.js";
import { getSession, saveSession, deleteSession } from "./session.js";
import { log } from "./logger.js";
import { notificarSuporte } from "./zapi.js";

const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT || "0", 10) || 180_000;

export async function processMessage(message, chatId, from) {
  log(`[WhatsApp] [${from}] ${message}`);

  let session = getSession(chatId);
  const now = Date.now();

  if (session && now - session.lastInteraction > SESSION_TIMEOUT) {
    console.log(`⏰ Sessão expirada para ${from}`);
    deleteSession(chatId);
    session = null;
  }

  const isNew = !session;
  if (!session) {
    session = { step: "start", name: null, ip: null, attempts: 0, lastInteraction: now };
  }

  const msg = normalizar(message);
  console.log(`🔄 [${from}] step="${session.step}" msg="${msg.slice(0, 60)}"`);

  // ── Iniciador silencioso (áudio sem sessão) ──────────────────────
  if (msg === "__init__") {
    if (isNew) {
      session.step = "ask_name";
      session.lastInteraction = now;
      saveSession(chatId, session);
      return `Oi! 😊 Sou a assistente do microterminal da ThR.\n\nQual seu nome?`;
    }
    return null;
  }

  // ── Comandos globais ─────────────────────────────────────────────
  if (msg === "reset") {
    deleteSession(chatId);
    return "Memória resetada 🔄\n\nPode começar de novo quando quiser 😊";
  }

  if (contemAlgum(msg, ["obrigado","obrigada","obg","valeu","tchau","até logo","flw","falou"])) {
    deleteSession(chatId);
    return "Por nada! 😊\n\nQualquer coisa, é só chamar! 👍";
  }

  // ── Usuário confuso / pedindo repetição ──────────────────────────
  if (contemAlgum(msg, ["?","oi?","hein","como assim","não entendi","nao entendi","que","oque","o que","kk","kkk"])) {
    return repetirPasso(session);
  }

  // ── Sessão nova com contexto de problema ────────────────────────
  if (isNew && looksLikeProblem(msg)) {
    session.step = "ask_name_then_problem";
    session.pendingProblem = message;
    session.lastInteraction = now;
    saveSession(chatId, session);
    return `Oi! 😊 Sou a assistente do microterminal da ThR.\n\nEntendi que você está com um problema — me diz seu nome que já te ajudo! 👍`;
  }

  let reply = "";

  switch (session.step) {

    // ── start ────────────────────────────────────────────────────
    case "start": {
      session.step = "ask_name";
      reply = `Oi! 😊 Sou a assistente do microterminal da ThR.\n\nQual seu nome?`;
      break;
    }

    // ── ask_name ─────────────────────────────────────────────────
    case "ask_name": {
      // Se mandou só saudação, pede o nome de novo
      if (contemAlgum(msg, ["oi","olá","ola","bom dia","boa tarde","boa noite","hey","hi"]) && msg.split(" ").length <= 2) {
        reply = `Oi! 😄\n\nQual é o seu nome?`;
        break;
      }
      session.name = message.trim().split(" ")[0];
      session.step = "ask_problem";
      reply = `Prazer, ${session.name}! 😊\n\nPode me contar o que está acontecendo com o microterminal?`;
      break;
    }

    // ── ask_name_then_problem ────────────────────────────────────
    case "ask_name_then_problem": {
      session.name = message.trim().split(" ")[0];
      const problema = session.pendingProblem || "";
      session.pendingProblem = null;
      session.step = "ask_problem";
      session.lastInteraction = now;
      saveSession(chatId, session);
      return processMessage(problema, chatId, from);
    }

    // ── ask_problem ───────────────────────────────────────────────
    case "ask_problem": {
      if (contemAlgum(msg, ["nada","de boa","tranquilo","testando","resolvido","tudo bem","tá bem","ta bem"])) {
        deleteSession(chatId);
        return `Ahh que bom, ${session.name || ""}! 😄\n\nEntão já está tudo certo 👍\n\nQualquer coisa, é só chamar!`;
      }

      // Se mensagem muito vaga, pede mais detalhes
      if (msg.length < 5) {
        reply = `Me conta um pouco mais sobre o que está acontecendo 😊\n\nPor exemplo: "o microterminal não conecta na rede" ou "aparece erro na tela"`;
        break;
      }

      // Salva antes da IA para não perder estado
      session.lastInteraction = now;
      saveSession(chatId, session);

      let respostaRAG = null;
      try {
        respostaRAG = await responderComRAG(message, session.name);
      } catch (e) {
        console.error("Erro RAG:", e.message);
      }

      if (respostaRAG) {
        session.step = "rag_followup";
        reply = `${respostaRAG}\n\n---\nIsso resolveu seu problema? 😊`;
      } else {
        session.step = "ask_ip";
        reply = buildAskIpMsg(session.name);
      }
      break;
    }

    // ── rag_followup ──────────────────────────────────────────────
    case "rag_followup": {
      if (isPositive(msg)) {
        deleteSession(chatId);
        return `Boa, ${session.name}! 🎉\n\nFico feliz que ajudou 😄\n\nQualquer coisa, é só chamar!`;
      }
      session.step = "ask_ip";
      reply = `Entendido, vamos verificar mais a fundo 👇\n\n${buildAskIpMsg(session.name)}`;
      break;
    }

    // ── ask_ip ────────────────────────────────────────────────────
    case "ask_ip": {
      // Usuário já mandou o IP junto com a resposta
      const ipDireto = extrairIP(msg);
      if (ipDireto) {
        session.ip = ipDireto;
        session.attempts = 0;
        session.step = "config_terminal";
        reply = buildConfigMsg(session.ip);
        break;
      }

      session.step = "teach_ip";

      if (isNegative(msg) || contemAlgum(msg, ["sei não","nao sei","não sei","nao tenho","não tenho","nao lembro","não lembro","sem acesso","nao tenho acesso"])) {
        reply = instrucaoIP();
      } else if (contemAlgum(msg, ["sei","tenho","sei sim","tenho sim","lembro"])) {
        reply = `Ótimo! Me manda o IP então 😊`;
      } else {
        // Resposta ambígua — repete a pergunta com mais contexto
        reply = buildAskIpMsg(session.name);
        session.step = "ask_ip"; // mantém no mesmo step
      }
      break;
    }

    // ── teach_ip ──────────────────────────────────────────────────
    case "teach_ip": {
      const ip = extrairIP(msg);
      if (ip) {
        session.ip = ip;
        session.attempts = 0;
        session.step = "config_terminal";
        reply = buildConfigMsg(session.ip);
      } else if (contemAlgum(msg, ["não consigo","nao consigo","não aparece","nao aparece","nao tenho","não tenho","nao encontro","não encontro","sem acesso","nao sei","não sei"])) {
        reply = `Tudo bem! Tenta assim 👇\n\n1️⃣ Pressiona *Windows + R*\n2️⃣ Digita *cmd* e Enter\n3️⃣ Digita *ipconfig* e Enter\n4️⃣ Procura *Endereço IPv4*\n\nO número vai ter esse formato: *192.168.x.x*\n\nMe manda quando encontrar 😊`;
      } else {
        reply = `Preciso do IP para continuar 😊\n\nÉ um número assim: *192.168.x.x*\n\nEstá conseguindo encontrar? Se quiser, posso te guiar passo a passo 👍`;
      }
      break;
    }

    // ── config_terminal ───────────────────────────────────────────
    case "config_terminal": {
      if (isPositive(msg)) {
        session.step = "confirm_done";
        reply = `Boa! 👍\n\nSó pra confirmar: está funcionando normalmente agora? 😊`;
        break;
      }

      // Verifica se veio um IP novo na mensagem
      const novoIp = extrairIP(msg);
      if (novoIp && novoIp !== session.ip) {
        session.ip = novoIp;
        reply = `Anotei o novo IP: *${session.ip}* 👍\n\n${buildConfigMsg(session.ip, true)}`;
        break;
      }

      session.attempts = (session.attempts || 0) + 1;

      if (session.attempts === 1) {
        reply = `Vamos checar passo a passo 👇\n\n🔹 *IP:* \`${session.ip || "não informado"}\`\nConferiu se digitou exatamente esse número?\n\n🔹 *Cabo de rede* 🔌\nTira e recoloca o cabo\n\n🔹 *Teste no cmd:* \`ping ${session.ip || "IP"}\`\nAparece resposta ou "tempo esgotado"?\n\n🔹 *Reiniciar o terminal* 🔄\nDesliga e liga de novo\n\nMe conta o que apareceu 😊`;
      } else if (session.attempts === 2) {
        reply = `Ainda não foi 😕 Última tentativa antes de chamar suporte:\n\n1️⃣ *Desplugue* o microterminal da tomada\n2️⃣ Aguarde *30 segundos*\n3️⃣ *Religue*\n4️⃣ Configure o IP de novo: *1 → ${session.ip} → Enter → H*\n\nFuncionou agora? 😊`;
      } else {
        session.step = "escalation";
        reply = `Entendo que está sendo difícil 😕\n\nJá tentamos várias coisas e o problema persiste.\n\nPosso te colocar na fila de suporte humano da ThR — um técnico entra em contato aqui pelo WhatsApp para te ajudar 👨‍🔧\n\nQuer que eu faça isso? Responde *sim* ou *não*`;
      }
      break;
    }

    // ── escalation ────────────────────────────────────────────────
    case "escalation": {
      if (isPositive(msg)) {
        notificarSuporte(session.name, from, session.ip).catch(() => {});
        deleteSession(chatId);
        return `Feito! ✅\n\nVocê está na fila de suporte da ThR.\n\nEm breve um técnico entra em contato aqui pelo WhatsApp 🛠️\n\nQualquer dúvida, é só chamar!`;
      }
      if (isNegative(msg)) {
        session.step = "config_terminal";
        reply = `Tudo bem! Vamos continuar tentando 💪\n\nMe conta o que está aparecendo no microterminal agora?`;
      } else {
        reply = `Para chamar o suporte, responde *sim*.\nSe quiser continuar tentando, responde *não* 😊`;
      }
      break;
    }

    // ── confirm_done ──────────────────────────────────────────────
    case "confirm_done": {
      if (isPositive(msg)) {
        deleteSession(chatId);
        return `Boa, ${session.name}! 🎉\n\nFuncionou! 😄\n\nQualquer coisa, é só chamar 👍`;
      }
      session.attempts = (session.attempts || 0) + 1;
      if (session.attempts >= 3) {
        session.step = "escalation";
        reply = `Entendo 😕\n\nVamos acionar o suporte humano da ThR para resolver isso de vez.\n\nPosso te colocar na fila? Responde *sim* ou *não* 👨‍🔧`;
      } else {
        session.step = "config_terminal";
        reply = `Entendido 😕 Vamos continuar!\n\nO que exatamente está acontecendo agora?`;
      }
      break;
    }

    // ── fallback ──────────────────────────────────────────────────
    default: {
      session.step = "ask_problem";
      reply = `Me conta o que está acontecendo com o microterminal 😊`;
    }
  }

  session.lastInteraction = Date.now();
  saveSession(chatId, session);
  return reply;
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/** Normaliza a mensagem: lowercase, sem acentos para comparação */
function normalizar(text) {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove acentos
    .trim();
}

/** Verifica se a mensagem contém pelo menos uma das palavras/frases */
function contemAlgum(msg, lista) {
  return lista.some(w => msg.includes(w));
}

/** Extrai o primeiro IP válido da mensagem */
function extrairIP(msg) {
  const match = msg.match(/\b((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/);
  return match ? match[0] : null;
}

/**
 * Retorna true APENAS se a mensagem é claramente positiva/afirmativa.
 * Verifica se existe negação ANTES da palavra positiva na frase.
 */
function isPositive(msg) {
  const affirmatives = [
    "sim", "ss", "foi", "funcionou", "resolveu", "deu certo",
    "conectou", "quero", "exato", "perfeito", "ta bom", "otimo",
    "consegui", "resolvido", "tudo certo", "conectou", "tá ok", "ta ok",
    "tô vendo", "to vendo", "apareceu", "está funcionando", "ta funcionando"
  ];

  for (const word of affirmatives) {
    if (!msg.includes(word)) continue;
    const affIdx = msg.indexOf(word);
    const negMatch = msg.match(/\bn[aã]o\b/);
    // Negação antes da palavra afirmativa → não é positivo
    if (negMatch && negMatch.index <= affIdx) continue;
    return true;
  }
  return false;
}

function isNegative(msg) {
  // Cobre: "não", "nao", "nop", "negativo", "sei não" (invertido), "tenho não"
  return /\bn[aã]o\b/.test(msg) ||
         /\bsei\s+n[aã]o\b/.test(msg) ||
         /\btenho\s+n[aã]o\b/.test(msg) ||
         /\bnop\b/.test(msg) ||
         /\bnegativo\b/.test(msg);
}

function looksLikeProblem(msg) {
  return contemAlgum(msg, [
    "nao conecta", "nao conect", "sem conexao", "sem internet",
    "problema", "erro", "travou", "desligou", "nao funciona",
    "nao liga", "caiu", "parou", "nao ta", "nao esta",
    "ajuda", "preciso", "microterminal", "terminal", "micro"
  ]);
}

function buildAskIpMsg(name) {
  const n = name ? `${name}, você` : "Você";
  return `${n} sabe o IP do computador? 😊\n\nSe souber, me manda direto.\nSe não souber, é só falar *"não sei"* que te ensino a encontrar 👍`;
}

function instrucaoIP() {
  return `Sem problema! Vamos buscar o IP 👇\n\n1️⃣ Pressione a tecla *Windows*\n2️⃣ Digite *cmd* e abra\n3️⃣ Digite *ipconfig* e pressione Enter\n4️⃣ Procure por *Endereço IPv4*\n\nO número fica assim: *192.168.x.x*\n\nMe manda quando encontrar 😊`;
}

function buildConfigMsg(ip, soPassos = false) {
  const intro = soPassos ? "" : `Anotei o IP: *${ip}* 👍\n\n`;
  return `${intro}Agora no microterminal:\n\n1️⃣ Pressione *1*\n2️⃣ Digite o IP: *${ip}*\n3️⃣ Pressione *Enter*\n4️⃣ Pressione *H* para salvar\n\nMe avisa quando terminar 😊`;
}

/** Repete a instrução do passo atual quando usuário parece confuso */
function repetirPasso(session) {
  const nome = session.name ? `, ${session.name}` : "";
  switch (session.step) {
    case "ask_name":
      return `Qual é o seu nome? 😊`;
    case "ask_problem":
      return `Me conta o que está acontecendo com o microterminal${nome} 😊`;
    case "ask_ip":
    case "teach_ip":
      return session.ip
        ? `Preciso que você me mande o IP do computador${nome} 😊\n\nSe não souber como encontrar, é só falar *"não sei"* 👍`
        : buildAskIpMsg(session.name);
    case "config_terminal":
      return `Você configurou o IP *${session.ip}* no microterminal${nome}? Me avisa se deu certo 😊`;
    case "escalation":
      return `Quer que eu chame o suporte humano da ThR${nome}?\n\nResponde *sim* para chamar ou *não* para continuar tentando 😊`;
    case "confirm_done":
      return `Está funcionando normalmente agora${nome}? 😊`;
    default:
      return `Me conta o que está acontecendo com o microterminal${nome} 😊`;
  }
}
