import { responderComRAG } from "./ai.js";
import { getSession, saveSession, deleteSession } from "./session.js";
import { log } from "./logger.js";
import { notificarSuporte } from "./zapi.js";
import { notificarSuporteMeta } from "./meta.js";
import {
  processConversation,
  normalizar,
  fuzzyNormalizar,
  extrairNome,
  contemAlgum,
  pick,
  looksLikeProblem,
  isBusinessHours,
} from "./chat-core.js";

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

  const msg = fuzzyNormalizar(normalizar(message));
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
    return pick(
      "Por nada! 😊\n\nQualquer coisa, é só chamar! 👍",
      "Disponha! 😄\n\nQualquer coisa, é só chamar 👍",
      "Fico feliz em ter ajudado! 😊\n\nEstou sempre por aqui, é só chamar 👍",
    );
  }

  // ── Usuário confuso / pedindo repetição ──────────────────────────
  const { repetirPasso } = await import("./chat-core.js");
  if (contemAlgum(msg, ["?","oi?","hein","como assim","não entendi","nao entendi","oque","o que","kk","kkk"])
      || msg === "que" || msg === "q") {
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

  // ── ask_name_then_problem (WhatsApp-specific) ────────────────────
  if (session.step === "ask_name_then_problem") {
    const nomeAtp = extrairNome(message);
    if (nomeAtp) session.name = nomeAtp;
    const problema = session.pendingProblem || "";
    session.pendingProblem = null;
    session.step = "ask_problem";
    session.lastInteraction = now;
    saveSession(chatId, session);
    return processMessage(problema, chatId, from);
  }

  // ── Notificador WhatsApp-specific ───────────────────────────────
  const notificar = async (name, _from, ip) => {
    if (chatId.startsWith("meta_")) {
      await notificarSuporteMeta(name, from, ip).catch(() => {});
    } else {
      await notificarSuporte(name, from, ip).catch(() => {});
    }
  };

  // ── Delegating to shared core ───────────────────────────────────
  const { reply, session: updatedSession, shouldDelete } = await processConversation(
    msg,
    message,
    session,
    { responderComRAG, notificar, chatId },
  );

  if (shouldDelete) {
    deleteSession(chatId);
  } else {
    updatedSession.lastInteraction = Date.now();
    saveSession(chatId, updatedSession);
  }

  return reply;
}
