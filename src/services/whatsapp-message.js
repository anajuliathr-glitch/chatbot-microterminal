import { responderComRAG } from "./ai.js";
import { getSession, saveSession, deleteSession } from "./session.js";
import { log } from "./logger.js";
import { notificarSuporte } from "./zapi.js";

export async function processMessage(message, chatId, from) {
  log(`[WhatsApp] [${from}] ${message}`);

  let session = getSession(chatId);
  const now = Date.now();
  const sessionTimeout = parseInt(process.env.SESSION_TIMEOUT || "0", 10) || 180000;

  if (session && now - session.lastInteraction > sessionTimeout) {
    console.log(`⏰ Sessão expirada para ${from} — reiniciando`);
    deleteSession(chatId);
    session = null;
  }

  const isNew = !session;
  if (!session) {
    session = { step: "start", name: null, ip: null, attempts: 0, lastInteraction: now };
  }

  const msg = message.toLowerCase().trim();

  // Comandos globais
  if (msg === "reset") {
    deleteSession(chatId);
    return "Memória resetada 🔄\n\nPode começar de novo quando quiser 😊";
  }

  if (["obrigado","obrigada","obg","valeu","tchau","até","flw"].some(w => msg.includes(w))) {
    deleteSession(chatId);
    return "Por nada! 😊\n\nQualquer coisa, é só chamar! 👍";
  }

  // Se a sessão foi perdida mas o usuário continua falando sobre o problema
  // (detecta contexto para não perguntar o nome de novo)
  if (isNew && looksLikeProblem(msg)) {
    session.step = "ask_name_then_problem";
    session.pendingProblem = message;
    session.lastInteraction = now;
    saveSession(chatId, session);
    return `Oi! 😊 Sou a assistente do microterminal da ThR.\n\nQual seu nome?`;
  }

  let reply = "";

  switch (session.step) {

    case "start": {
      session.step = "ask_name";
      reply = `Oi! 😊 Sou a assistente do microterminal da ThR.\n\nQual seu nome?`;
      break;
    }

    case "ask_name": {
      session.name = message.split(" ")[0];
      session.step = "ask_problem";
      reply = `Prazer, ${session.name}! 😊\n\nPode me contar o que está acontecendo?`;
      break;
    }

    // Caso especial: usuário descreveu o problema antes de informar o nome
    case "ask_name_then_problem": {
      session.name = message.split(" ")[0];
      const problema = session.pendingProblem || "";
      session.pendingProblem = null;
      session.step = "ask_problem";
      session.lastInteraction = now;
      saveSession(chatId, session);
      // Processa o problema pendente
      return processMessage(problema, chatId, from);
    }

    case "ask_problem": {
      // Usuário diz que está tudo bem
      if (["nada","nada não","de boa","tranquilo","testando","resolvido","funcionou","foi"].some(w => msg.includes(w))) {
        deleteSession(chatId);
        return `Ahh que bom, ${session.name || ""}! 😄\n\nEntão já está tudo certo 👍\n\nQualquer coisa, é só chamar!`;
      }

      // Salva antes da chamada IA para não perder estado em caso de crash
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
        reply = buildAskIpMessage(session.name);
      }
      break;
    }

    case "rag_followup": {
      if (isAffirmative(msg)) {
        deleteSession(chatId);
        return `Boa, ${session.name}! 🎉\n\nFico feliz que ajudou 😄\n\nQualquer coisa, é só chamar!`;
      }
      session.step = "ask_ip";
      reply = `Entendido, vamos verificar mais a fundo 👇\n\n${buildAskIpMessage(session.name)}`;
      break;
    }

    case "ask_ip": {
      session.step = "teach_ip";
      if (isNegative(msg)) {
        reply = `Sem problema! Vamos buscar o IP juntos 👇\n\n1️⃣ Pressione a tecla *Windows*\n2️⃣ Digite: *cmd* e abra\n3️⃣ Digite: *ipconfig*\n4️⃣ Procure por *Endereço IPv4*\n\nMe manda o número que aparecer 😊`;
      } else {
        reply = `Perfeito! Me manda o IP 😊`;
      }
      break;
    }

    case "teach_ip": {
      const ipRegex = /\b(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b/;
      const ipMatch = msg.match(ipRegex);
      if (ipMatch) {
        session.ip = ipMatch[0];
        session.attempts = 0;
        session.step = "config_terminal";
        reply = `Perfeito, anotei o IP: *${session.ip}* 👍\n\nAgora no microterminal:\n\n1️⃣ Pressione *1*\n2️⃣ Digite o IP: *${session.ip}*\n3️⃣ Pressione *Enter*\n4️⃣ Pressione *H* para salvar\n\nMe avisa quando terminar 😊`;
      } else {
        reply = `Pode me mandar o número do IP? 😊\n\nEle aparece depois de "Endereço IPv4" e tem esse formato: *192.168.x.x*\n\nSe tiver dificuldade, é só falar que te ajudo 👍`;
      }
      break;
    }

    case "config_terminal": {
      if (isAffirmative(msg) || ["conectou","funcionou","foi","deu certo","ok","tá funcionando"].some(w => msg.includes(w))) {
        session.step = "confirm_done";
        reply = `Boa! 👍\n\nSó pra confirmar: está funcionando normalmente agora? 😊`;
      } else {
        session.attempts = (session.attempts || 0) + 1;
        if (session.attempts === 1) {
          reply = `Vamos checar passo a passo 👇\n\n🔹 *IP digitado:* ${session.ip || "não informado"}\nConferiu se está exatamente igual?\n\n🔹 *Cabo de rede 🔌*\nTira e coloca o cabo\n\n🔹 *Teste de conexão*\nNo cmd: *ping ${session.ip || "IP"}*\n\n🔹 *Reiniciar o microterminal*\nDesliga e liga de novo\n\nMe fala o que aconteceu 😊`;
        } else if (session.attempts === 2) {
          reply = `Ainda não foi 😕 Vamos tentar mais uma vez:\n\n1️⃣ *Desligue* o microterminal da tomada\n2️⃣ Aguarde *30 segundos*\n3️⃣ *Ligue* novamente\n4️⃣ Configure o IP de novo: *1 → IP → Enter → H*\n\nO que aconteceu? 😊`;
        } else {
          session.step = "escalation";
          reply = `Entendo que está sendo difícil resolver 😕\n\nJá tentamos bastante coisa e o problema persiste.\n\nPosso te colocar na fila de suporte humano da ThR — em breve um técnico entra em contato com você aqui pelo WhatsApp 👨‍🔧\n\nQuer que eu faça isso? Responde *sim* ou *não*`;
        }
      }
      break;
    }

    case "escalation": {
      if (isAffirmative(msg)) {
        notificarSuporte(session.name, from, session.ip).catch(() => {});
        deleteSession(chatId);
        return `Feito! ✅\n\nVocê está na fila de suporte da ThR.\n\nEm breve um de nossos técnicos vai entrar em contato com você aqui pelo WhatsApp 🛠️\n\nQualquer dúvida, é só chamar!`;
      } else {
        session.step = "config_terminal";
        reply = `Tudo bem, vamos continuar tentando 💪\n\nMe conta o que está aparecendo no microterminal agora?`;
      }
      break;
    }

    case "confirm_done": {
      if (isAffirmative(msg)) {
        deleteSession(chatId);
        return `Boa, ${session.name}! 🎉\n\nFuncionou 😄\n\nQualquer coisa, é só chamar 👍`;
      }
      session.step = "config_terminal";
      reply = `Beleza, vamos continuar 👇\n\nO que ainda está acontecendo?`;
      break;
    }

    default: {
      reply = `Se precisar de ajuda com o microterminal, é só me contar o que está acontecendo 😊`;
    }
  }

  session.lastInteraction = Date.now();
  saveSession(chatId, session);
  return reply;
}

// --- Helpers ---

function isAffirmative(msg) {
  return ["sim","simm","ss","s ","^s$","foi","funcionou","resolveu","deu certo","conectou","pode","quero","certo","isso","exato","perfeito"].some(w => msg.includes(w));
}

function isNegative(msg) {
  return ["nao","não","neg","nunca","jamais"].some(w => msg.includes(w));
}

function looksLikeProblem(msg) {
  return ["nao conecta","não conecta","sem conexão","sem conexao","problema","erro","travou","desligou","nao funciona","não funciona","ajuda","preciso","microterminal"].some(w => msg.includes(w));
}

function buildAskIpMessage(name) {
  return `${name ? `${name}, você` : "Você"} sabe o IP do computador? 😊\n\nSe souber, me manda. Se não souber, é só falar que te ensino a encontrar 👍`;
}
