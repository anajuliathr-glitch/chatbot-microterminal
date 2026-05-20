import { responderComRAG } from "./ai.js";
import { getSession, saveSession, deleteSession } from "./session.js";
import { log } from "./logger.js";
import { notificarSuporte } from "./zapi.js";
import { notificarSuporteMeta } from "./meta.js";

const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT || "0", 10) || 900_000; // 15 min

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
      if (isBusinessHours()) {
        reply = `Oi! 😊 Sou a assistente do microterminal da ThR.\n\nQual seu nome?`;
      } else {
        reply = `${MSG_FORA_HORARIO}Qual seu nome?`;
      }
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

      // Quer suporte humano direto, sem nem descrever o problema
      if (contemAlgum(msg, ["suporte","tecnico","técnico","quero ajuda","falar com alguem","falar com alguém","atendente","humano"])) {
        session.step = "escalation";
        reply = `Claro! Posso te colocar na fila de *suporte humano* da ThR — um técnico entra em contato aqui pelo WhatsApp ou por ligação 👨‍🔧\n\nQuer isso? Responde *sim* ou *não*`;
        break;
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
      } else if (!session.clarificationAsked) {
        // Primeira tentativa sem entender: pede mais detalhes antes de pular pro IP
        session.clarificationAsked = true;
        reply = (
          `Hmm, não entendi muito bem 😊\n\n` +
          `Pode me contar melhor o que está acontecendo com o microterminal?\n\n` +
          `Por exemplo:\n` +
          `• O terminal está desconectado / não conecta na rede?\n` +
          `• Aparece alguma mensagem de erro na tela?\n` +
          `• É uma dúvida sobre como configurar?\n` +
          `• Outra coisa?\n\n` +
          `Com mais detalhes consigo te ajudar melhor 👍`
        );
      } else {
        // Segunda tentativa ainda sem entender: vai pro fluxo de IP
        session.step = "ask_ip";
        reply = `Entendido! Vamos verificar a configuração 👍\n\n${buildAskIpMsg(session.name)}`;
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

      // Não conseguiu pressionar P a tempo
      if (contemAlgum(msg, ["nao consegui", "não consegui", "passou rapido", "passou rápido", "perdi", "nao deu tempo", "não deu tempo", "nao apareceu", "não apareceu"])) {
        reply = (
          `Não tem problema! Tenta assim:\n\n` +
          `1️⃣ *Confere se o teclado está plugado* no microterminal antes de ligar\n` +
          `   _(sem teclado conectado, o P não funciona)_\n` +
          `2️⃣ Desligue o microterminal\n` +
          `3️⃣ *Antes de ligar*, posicione o dedo já na tecla *P*\n` +
          `4️⃣ Ligue e pressione o *P imediatamente* assim que ligar\n\n` +
          `A janela dos pontinhos é bem rápida — com o dedo já posicionado fica muito mais fácil 😊`
        );
        break;
      }

      // Não apareceu o menu de configuração
      if (contemAlgum(msg, ["nao apareceu menu", "não apareceu menu", "nao abriu", "não abriu", "nao entrou", "não entrou", "nao foi", "não foi para o menu"])) {
        reply = `Quando você pressiona P, o microterminal deve mostrar um menu com as opções de IP.\n\nSe não apareceu, pode ser que o teclado não estava conectado antes de ligar — isso é importante!\n\n🔌 *Verifique:* o teclado estava plugado *antes* de ligar o terminal?\n\nSe estava, tenta pressionar P mais rápido logo que ligar 😊`;
        break;
      }

      // Não conectou após salvar
      if (contemAlgum(msg, ["nao conectou", "não conectou", "salvei e nao", "salvei e não", "carregando", "fica carregando", "nao conecta", "não conecta"])) {
        reply = `Salvou mas não conectou 🤔 Vamos verificar:\n\n🔹 *IP correto?*\nRodou o \`ipconfig\` no computador e conferiu o *Endereço IPv4*?\n_(Se tiver WiFi e cabo, use o IP do *cabo de rede*)_\n\n🔹 *Cabo de rede* 🔌\nO microterminal está com o cabo encaixado firmemente?\n\n🔹 *Teste de conexão:*\nNo computador, abra o cmd e digite:\n\`ping ${session.ip || "IP_DO_SERVIDOR"}\`\n\nAparece resposta ou "tempo esgotado"?\n\nMe conta o que apareceu 😊`;
        break;
      }

      // IP errado — mencionou que digitou errado
      if (contemAlgum(msg, ["errei", "digitei errado", "ip errado", "errado", "coloquei errado"])) {
        reply = `Sem problema! Para corrigir:\n\n${buildConfigMsg(session.ip, true)}\n\n_(Refaz o processo do zero: desliga, liga, P, 1, digita o IP certo, Enter, H, 1)_`;
        break;
      }

      session.attempts = (session.attempts || 0) + 1;

      if (session.attempts === 1) {
        reply = (
          `Vamos checar 👇\n\n` +
          `🔹 *Conferiu o IP?*\n` +
          `O IP que você digitou foi *${session.ip || "?"}*\n` +
          `Verifique no cmd (\`ipconfig\`) se esse número ainda é o mesmo\n` +
          `_(Se aparecer WiFi e cabo, use o do *cabo*)_\n\n` +
          `🔹 *Pressionou P na hora certa?*\n` +
          `Desligue e ligue de novo o microterminal, com o dedo já posicionado no P\n\n` +
          `🔹 *Cabo de rede* 🔌\n` +
          `Tira e recoloca o cabo do terminal\n\n` +
          `Me conta o que aparece agora 😊`
        );
      } else if (session.attempts === 2) {
        reply = (
          `Ainda não foi 😕 Tenta assim:\n\n` +
          `1️⃣ *Desplugue* o microterminal da tomada\n` +
          `2️⃣ Aguarde *30 segundos*\n` +
          `3️⃣ Religue e pressione *P* nos pontinhos\n` +
          `4️⃣ Pressione *1*, digite *${session.ip}*, Enter, H, 1 para salvar\n\n` +
          `Funcionou agora? 😊`
        );
      } else {
        session.step = "escalation";
        reply = (
          `Entendo que está sendo difícil 😕\n\n` +
          `Já tentamos várias vezes e o problema persiste.\n\n` +
          `Posso te colocar na fila de *suporte humano* da ThR — um técnico entra em contato aqui pelo WhatsApp ou por ligação para te ajudar remotamente 👨‍🔧\n\n` +
          `Quer que eu faça isso? Responde *sim* ou *não*`
        );
      }
      break;
    }

    // ── escalation ────────────────────────────────────────────────
    case "escalation": {
      if (isPositive(msg)) {
        // Usa o notificador certo conforme o canal (meta_ ou zapi_)
        if (chatId.startsWith("meta_")) {
          notificarSuporteMeta(session.name, from, session.ip).catch(() => {});
        } else {
          notificarSuporte(session.name, from, session.ip).catch(() => {});
        }
        deleteSession(chatId);
        const contatoMsg = isBusinessHours()
          ? `Em breve um técnico entra em contato aqui pelo WhatsApp 🛠️`
          : `Como estamos fora do horário agora, um técnico entra em contato assim que estivermos ON (seg-sex 8h-18h) 🛠️`;
        return `Feito! ✅\n\nVocê está na fila de suporte da ThR.\n\n${contatoMsg}\n\nQualquer dúvida, é só chamar!`;
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

/** Verifica se está no horário de atendimento (seg-sex 8h-18h, fuso Brasília) */
function isBusinessHours() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const day  = now.getDay();
  const hour = now.getHours();
  return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
}

const MSG_FORA_HORARIO =
  `Olá! Você está fora do horário de atendimento (seg-sex 8h-18h) 🫤\n\n` +
  `Mas não tem problema, sou um BOT de atendimento e posso te ajudar com dúvidas e problemas pontuais sobre o microterminal. ` +
  `Caso não consigamos resolver hoje, vou registrar seu caso e um técnico entra em contato assim que estivermos ON de novo 😁👍\n\n`;

/** Normaliza a mensagem: lowercase, sem acentos + typos comuns */
function normalizar(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim()

    // ── abreviações e gírias ──────────────────────────────────────
    .replace(/\bnaum\b/g, "nao")
    .replace(/\bvc\b/g, "voce")
    .replace(/\boq\b/g, "o que")
    .replace(/\bpq\b/g, "porque")
    .replace(/\bmt\b/g, "muito")
    .replace(/\btb\b/g, "tambem")
    .replace(/\bmsm\b/g, "mesmo")
    .replace(/\baki\b/g, "aqui")
    .replace(/\bnop+\b/g, "nao")

    // ── typos de "sim" ────────────────────────────────────────────
    .replace(/\bso+m\b/g, "sim")
    .replace(/\bsi+m+\b/g, "sim")
    .replace(/\bsi\b/g, "sim")
    .replace(/\bsium\b/g, "sim")

    // ── typos de "ainda" ─────────────────────────────────────────
    .replace(/\baind[sa]?\b/g, "ainda")

    // ── microterminal ─────────────────────────────────────────────
    .replace(/\bmicro\s+terminal\b/g, "microterminal")
    .replace(/\bmicroterminau\b/g, "microterminal")
    .replace(/\bmictroterminal\b/g, "microterminal")
    .replace(/\bmircoterminal\b/g, "microterminal")
    .replace(/\bmicrotermianl\b/g, "microterminal")
    .replace(/\bmicrotermial\b/g, "microterminal")

    // ── terminações "au" no lugar de "ou"/"al" ────────────────────
    .replace(/\bterminau\b/g, "terminal")
    .replace(/\bfuncionau\b/g, "funcionou")
    .replace(/\bconectau\b/g, "conectou")
    .replace(/\bdesligau\b/g, "desligou")
    .replace(/\bligau\b/g, "ligou")
    .replace(/\bsalvau\b/g, "salvou")
    .replace(/\btravau\b/g, "travou")
    .replace(/\berradu\b/g, "errado")

    // ── typos de "problema" ───────────────────────────────────────
    .replace(/\bpoblema\b/g, "problema")
    .replace(/\bporblema\b/g, "problema")
    .replace(/\bproblemon\b/g, "problema")

    // ── typos de "configurar/pressionar" ─────────────────────────
    .replace(/\bcofigurar\b/g, "configurar")
    .replace(/\bconfigurau\b/g, "configurou")
    .replace(/\bprecionar\b/g, "pressionar")
    .replace(/\bprecionei\b/g, "pressionei");
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
    "ajuda", "preciso", "microterminal", "terminal", "micro",
    "nao aparece", "nao abre", "tela preta", "pontinho", "pontinhos",
    "nao salva", "nao salvo", "nao sei", "ip", "configurar",
    "como faco", "como faço", "reiniciar", "religa", "travado"
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
  return (
    `${intro}Agora vamos configurar o microterminal:\n\n` +
    `1️⃣ Certifique-se que o *teclado está conectado* no microterminal\n` +
    `2️⃣ *Desligue* o microterminal e *ligue* novamente\n` +
    `3️⃣ Assim que aparecerem os *pontinhos na tela*, pressione a tecla *P*\n` +
    `   _(deixe o dedo já posicionado no P antes de ligar)_\n` +
    `4️⃣ No menu que aparecer, pressione *1* (IP do servidor)\n` +
    `5️⃣ Digite o IP: *${ip}*\n` +
    `6️⃣ Pressione *Enter*\n` +
    `7️⃣ Pressione *H*\n` +
    `8️⃣ Pressione *1* para salvar e sair\n\n` +
    `Aguarde — o terminal vai conectar automaticamente 😊\n\nMe avisa como foi!`
  );
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
      return session.ip
        ? `Você fez os passos no microterminal${nome}?\n\n_(Desligar → ligar → P nos pontinhos → 1 → IP ${session.ip} → Enter → H → 1 para salvar)_\n\nMe avisa como foi 😊`
        : `Me conta o que aparece no microterminal agora${nome} 😊`;
    case "escalation":
      return `Quer que eu chame o suporte humano da ThR${nome}?\n\nResponde *sim* para chamar ou *não* para continuar tentando 😊`;
    case "confirm_done":
      return `Está funcionando normalmente agora${nome}? 😊`;
    default:
      return `Me conta o que está acontecendo com o microterminal${nome} 😊`;
  }
}
