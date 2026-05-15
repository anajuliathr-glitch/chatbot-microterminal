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

  const msg = message.toLowerCase().trim();
  console.log(`🔄 [${from}] step="${session.step}" isNew=${isNew} msg="${msg.slice(0, 50)}"`);

  // ── Iniciador silencioso (usado quando áudio chega sem sessão) ──
  if (msg === "__init__") {
    if (isNew) {
      session.step = "ask_name";
      session.lastInteraction = now;
      saveSession(chatId, session);
      return `Oi! 😊 Sou a assistente do microterminal da ThR.\n\nQual seu nome?`;
    }
    return null;
  }

  // ── Comandos globais ──
  if (msg === "reset") {
    deleteSession(chatId);
    return "Memória resetada 🔄\n\nPode começar de novo quando quiser 😊";
  }

  if (["obrigado","obrigada","obg","valeu","tchau","flw"].some(w => msg.includes(w))) {
    deleteSession(chatId);
    return "Por nada! 😊\n\nQualquer coisa, é só chamar! 👍";
  }

  // ── Sessão nova com contexto de problema ──
  if (isNew && looksLikeProblem(msg)) {
    session.step = "ask_name_then_problem";
    session.pendingProblem = message;
    session.lastInteraction = now;
    saveSession(chatId, session);
    return `Oi! 😊 Sou a assistente do microterminal da ThR.\n\nEntendi que você tem um problema — me diz seu nome que já te ajudo! 👍`;
  }

  let reply = "";

  switch (session.step) {

    // ── start ──────────────────────────────────────────────────
    case "start": {
      session.step = "ask_name";
      reply = `Oi! 😊 Sou a assistente do microterminal da ThR.\n\nQual seu nome?`;
      break;
    }

    // ── ask_name ───────────────────────────────────────────────
    case "ask_name": {
      session.name = message.trim().split(" ")[0];
      session.step = "ask_problem";
      reply = `Prazer, ${session.name}! 😊\n\nPode me contar o que está acontecendo?`;
      break;
    }

    // ── ask_name_then_problem ──────────────────────────────────
    case "ask_name_then_problem": {
      session.name = message.trim().split(" ")[0];
      const problema = session.pendingProblem || "";
      session.pendingProblem = null;
      session.step = "ask_problem";
      session.lastInteraction = now;
      saveSession(chatId, session);
      return processMessage(problema, chatId, from);
    }

    // ── ask_problem ────────────────────────────────────────────
    case "ask_problem": {
      if (["nada","de boa","tranquilo","testando","resolvido"].some(w => msg.includes(w))) {
        deleteSession(chatId);
        return `Ahh que bom, ${session.name || ""}! 😄\n\nEntão já está tudo certo 👍\n\nQualquer coisa, é só chamar!`;
      }

      // Salva antes da IA para não perder estado em caso de crash
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

    // ── rag_followup ───────────────────────────────────────────
    case "rag_followup": {
      if (isPositive(msg)) {
        deleteSession(chatId);
        return `Boa, ${session.name}! 🎉\n\nFico feliz que ajudou 😄\n\nQualquer coisa, é só chamar!`;
      }
      session.step = "ask_ip";
      reply = `Entendido, vamos verificar mais a fundo 👇\n\n${buildAskIpMsg(session.name)}`;
      break;
    }

    // ── ask_ip ─────────────────────────────────────────────────
    case "ask_ip": {
      session.step = "teach_ip";
      if (isNegative(msg)) {
        reply = `Sem problema! Vamos buscar o IP juntos 👇\n\n1️⃣ Pressione a tecla *Windows*\n2️⃣ Digite *cmd* e abra\n3️⃣ Digite *ipconfig*\n4️⃣ Procure por *Endereço IPv4*\n\nMe manda o número que aparecer 😊`;
      } else {
        reply = `Perfeito! Me manda o IP 😊`;
      }
      break;
    }

    // ── teach_ip ───────────────────────────────────────────────
    case "teach_ip": {
      const ipMatch = msg.match(/\b((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/);
      if (ipMatch) {
        session.ip = ipMatch[0];
        session.attempts = 0;
        session.step = "config_terminal";
        reply = `Anotei o IP: *${session.ip}* 👍\n\nAgora no microterminal:\n\n1️⃣ Pressione *1*\n2️⃣ Digite o IP: *${session.ip}*\n3️⃣ Pressione *Enter*\n4️⃣ Pressione *H* para salvar\n\nMe avisa quando terminar 😊`;
      } else {
        reply = `Me manda o número do IP 😊\n\nEle fica depois de *Endereço IPv4* e parece com *192.168.x.x*\n\nSe precisar de ajuda para encontrar, é só falar 👍`;
      }
      break;
    }

    // ── config_terminal ────────────────────────────────────────
    case "config_terminal": {
      if (isPositive(msg)) {
        session.step = "confirm_done";
        reply = `Boa! 👍\n\nSó pra confirmar: está funcionando normalmente agora? 😊`;
      } else {
        session.attempts = (session.attempts || 0) + 1;
        if (session.attempts === 1) {
          reply = `Vamos checar passo a passo 👇\n\n🔹 *IP:* ${session.ip || "não informado"}\nConferiu se digitou exatamente igual?\n\n🔹 *Cabo de rede* 🔌\nTira e coloca o cabo\n\n🔹 *Ping no cmd:* \`ping ${session.ip || "IP"}\`\n\n🔹 *Reiniciar* 🔄\nDesliga e liga o microterminal\n\nMe fala o que aconteceu 😊`;
        } else if (session.attempts === 2) {
          reply = `Ainda não foi 😕 Vamos tentar:\n\n1️⃣ *Desligue* o microterminal da tomada\n2️⃣ Aguarde *30 segundos*\n3️⃣ *Ligue* novamente\n4️⃣ Configure o IP de novo: *1 → IP → Enter → H*\n\nO que aconteceu? 😊`;
        } else {
          session.step = "escalation";
          reply = `Entendo que está sendo difícil resolver 😕\n\nJá tentamos bastante coisa e o problema persiste.\n\nPosso te colocar na fila de suporte humano da ThR — em breve um técnico entra em contato com você aqui pelo WhatsApp 👨‍🔧\n\nQuer que eu faça isso? Responde *sim* ou *não*`;
        }
      }
      break;
    }

    // ── escalation ─────────────────────────────────────────────
    case "escalation": {
      if (isPositive(msg)) {
        notificarSuporte(session.name, from, session.ip).catch(() => {});
        deleteSession(chatId);
        return `Feito! ✅\n\nVocê está na fila de suporte da ThR.\n\nEm breve um técnico entra em contato aqui pelo WhatsApp 🛠️\n\nQualquer dúvida, é só chamar!`;
      } else {
        session.step = "config_terminal";
        reply = `Tudo bem, vamos continuar tentando 💪\n\nMe conta o que está aparecendo no microterminal agora?`;
      }
      break;
    }

    // ── confirm_done ───────────────────────────────────────────
    case "confirm_done": {
      if (isPositive(msg)) {
        deleteSession(chatId);
        return `Boa, ${session.name}! 🎉\n\nFuncionou 😄\n\nQualquer coisa, é só chamar 👍`;
      }
      // Não resolveu — volta para tentar de novo com escalação disponível
      session.step = "config_terminal";
      session.attempts = (session.attempts || 0) + 1;
      if (session.attempts >= 3) {
        session.step = "escalation";
        reply = `Entendo 😕\n\nJá tentamos bastante coisa.\n\nPosso te colocar na fila de suporte humano da ThR para um técnico te ajudar diretamente? 👨‍🔧\n\nResponde *sim* ou *não*`;
      } else {
        reply = `Entendido 😕 Vamos continuar tentando!\n\nO que está acontecendo agora?`;
      }
      break;
    }

    // ── fallback ───────────────────────────────────────────────
    default: {
      session.step = "ask_problem";
      reply = `Me conta o que está acontecendo com o microterminal 😊`;
    }
  }

  session.lastInteraction = Date.now();
  saveSession(chatId, session);
  return reply;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Retorna true APENAS se a mensagem é claramente positiva.
 * Detecta negação ANTES da palavra positiva, independente da posição na frase.
 *
 * ✅ "sim", "foi", "deu certo", "funcionou"
 * ❌ "nao deu certo", "terminei, nao deu certo", "não funcionou"
 */
function isPositive(msg) {
  const affirmatives = [
    "sim", "ss", "foi", "funcionou", "resolveu", "deu certo",
    "conectou", "pode", "quero", "certo", "exato",
    "perfeito", "tá bom", "ta bom", "ótimo", "otimo",
    "consegui", "resolvido", "tudo certo", "tá ótimo"
  ];

  for (const word of affirmatives) {
    if (!msg.includes(word)) continue;

    const affIdx = msg.indexOf(word);
    // Procura "nao/não" em qualquer posição ANTES ou DENTRO da palavra afirmativa
    const negMatch = msg.match(/\bn[aã]o\b/);
    if (negMatch && negMatch.index <= affIdx) continue; // negação antes → não é positivo

    return true;
  }
  return false;
}

function isNegative(msg) {
  return /\bn[aã]o\b|nop|negativo/.test(msg);
}

function looksLikeProblem(msg) {
  return [
    "nao conecta", "não conecta", "sem conexão", "sem conexao",
    "problema", "erro", "travou", "desligou", "nao funciona",
    "não funciona", "ajuda", "preciso", "microterminal", "terminal"
  ].some(w => msg.includes(w));
}

function buildAskIpMsg(name) {
  const n = name ? `${name}, você` : "Você";
  return `${n} sabe o IP do computador? 😊\n\nSe souber me manda direto. Se não souber, é só falar que te ensino a encontrar 👍`;
}
