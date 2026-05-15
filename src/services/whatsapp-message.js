import { responderComRAG } from "./ai.js";
import { getSession, saveSession, deleteSession } from "./session.js";
import { log } from "./logger.js";
import { notificarSuporte } from "./zapi.js";
import config from "../config.js";

export async function processMessage(message, chatId, from) {
  log(`[WhatsApp] [${from}] ${message}`);
  let session = getSession(chatId);
  const now = Date.now();

  if (session && now - session.lastInteraction > config.sessionTimeout) {
    deleteSession(chatId);
    session = null;
  }

  if (!session) {
    session = { step: "start", name: null, ip: null, attempts: 0, lastInteraction: now };
  }

  const msg = message.toLowerCase().trim();

  if (msg === "reset") {
    deleteSession(chatId);
    return "Memória resetada 🔄";
  }

  if (["obrigado","obrigada","obg","valeu"].some(w => msg.includes(w))) {
    deleteSession(chatId);
    return "Por nada! 😊\n\nSe precisar, é só chamar! 👍";
  }

  let reply = "";

  if (session.step === "start") {
    session.step = "ask_name";
    reply = `Oi! 😊 Sou a assistente do microterminal da ThR.\n\nQual seu nome?`;
  }

  else if (session.step === "ask_name") {
    session.name = message.split(" ")[0];
    session.step = "ask_problem";
    reply = `Prazer, ${session.name}! 😊\n\nPode me dizer o que aconteceu?`;
  }

  else if (session.step === "ask_problem") {
    if (["nada","nada não","de boa","tranquilo","testando","resolvido"].some(w => msg.includes(w))) {
      deleteSession(chatId);
      return `Ahh perfeito ${session.name || ""}! 😄\n\nEntão já está tudo certo 👍`;
    }
    // Salva sessão antes da chamada IA para não perder o estado em caso de crash
    session.lastInteraction = Date.now();
    saveSession(chatId, session);
    let respostaRAG = null;
    try {
      respostaRAG = await responderComRAG(message, session.name);
    } catch (e) {
      console.error("Erro RAG no processMessage:", e.message);
    }
    if (respostaRAG) {
      session.step = "rag_followup";
      reply = `${respostaRAG}\n\n---\nIsso resolveu seu problema? 😊`;
    } else {
      session.step = "ask_ip";
      reply = `Entendido! 👍\n\nVocê sabe o IP do computador?`;
    }
  }

  else if (session.step === "rag_followup") {
    const affirmative = ["sim","simm","ss","s","foi","funcionou","resolveu","deu certo","conectou"].some(w => msg.includes(w));
    if (affirmative) {
      deleteSession(chatId);
      return `Boa ${session.name}! 🎉\n\nFico feliz que ajudou 😄`;
    }
    session.step = "ask_ip";
    reply = `Entendido, vamos verificar mais a fundo 👇\n\nVocê sabe o IP do computador?`;
  }

  else if (session.step === "ask_ip") {
    session.step = "teach_ip";
    reply = !["nao","não"].some(w => msg.includes(w))
      ? `Perfeito 👍\n\nPode me mandar o IP 😊`
      : `Sem problema! Vamos pegar o IP juntos 👇\n\n1. Aperte a tecla Windows 🪟\n2. Digite: cmd\n3. Abra\n4. Digite: ipconfig\n5. Procure por "IPv4"\n\nMe manda 👍`;
  }

  else if (session.step === "teach_ip") {
    const ipRegex = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
    if (ipRegex.test(msg.trim())) {
      session.ip = msg.trim();
      session.attempts = 0;
      session.step = "config_terminal";
      reply = `Perfeito 👍\n\nAgora no microterminal:\n\n1. Pressione 1\n2. Digite o IP: ${session.ip}\n3. Aperte Enter\n4. Aperte H para salvar\n\nMe avisa se deu certo 😊`;
    } else {
      reply = `Pode me mandar o IP 👍\n\nSe não souber como encontrar, é só falar que eu te ajudo 😊`;
    }
  }

  else if (session.step === "config_terminal") {
    if (["foi","sim","funcionou","conectou","deu certo"].some(w => msg.includes(w))) {
      session.step = "confirm_done";
      reply = `Boa 👍\n\nSó pra confirmar: está funcionando normalmente agora? 😊`;
    } else {
      session.attempts++;
      if (session.attempts === 1) {
        reply = `Vamos checar passo a passo 👇\n\n🔹 IP (${session.ip})\nConfere se digitou exatamente esse IP\n\n🔹 Cabo 🔌\nTira e coloca o cabo de rede\n\n🔹 Ping\nNo cmd: ping ${session.ip}\n\n🔹 Reiniciar 🔄\nDesliga e liga o microterminal\n\nMe fala o que aconteceu 😊`;
      } else if (session.attempts === 2) {
        reply = `Ainda não foi 😕 Vamos tentar:\n\n1. Desliga o microterminal da tomada\n2. Espera 30 segundos\n3. Liga de novo\n4. Configura o IP (1, IP, Enter, H)\n\nO que aconteceu? 😊`;
      } else {
        // Após 3 tentativas — escalação para humano
        session.step = "escalation";
        reply = `Entendo que está sendo difícil resolver 😕\n\nJá tentamos bastante coisa e o problema persiste.\n\nQuer que eu chame um técnico da ThR para te ajudar pessoalmente? 👨‍🔧\n\nResponde *sim* ou *não*`;
      }
    }
  }

  else if (session.step === "escalation") {
    if (["sim","s","ss","pode","quero"].some(w => msg.includes(w))) {
      notificarSuporte(session.name, from, session.ip).catch(() => {});
      deleteSession(chatId);
      return `Perfeito! 👍\n\nJá avisei nossa equipe técnica.\n\nEm breve um técnico da ThR entrará em contato com você 🛠️\n\nQualquer dúvida, é só chamar aqui!`;
    } else {
      session.step = "config_terminal";
      reply = `Tudo bem! Vamos continuar tentando 💪\n\nMe conta o que está aparecendo agora no microterminal?`;
    }
  }

  else if (session.step === "confirm_done") {
    const ok = ["sim","foi","funcionou","tá","ta"].some(w => msg.includes(w));
    if (ok) {
      deleteSession(chatId);
      return `Boa ${session.name}! 🎉\n\nFuncionou 😄\n\nQualquer coisa, chama 👍`;
    }
    session.step = "config_terminal";
    reply = `Beleza, vamos continuar 👇\n\nO que ainda está acontecendo?`;
  }

  else {
    reply = `Se precisar de algo, estou por aqui 👍`;
  }

  session.lastInteraction = Date.now();
  saveSession(chatId, session);
  return reply;
}
