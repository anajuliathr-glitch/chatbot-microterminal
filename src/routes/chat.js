import { Router } from "express";
import { log } from "../services/logger.js";
import { responderComRAG, analisarImagem, classificarIntencao } from "../services/ai.js";
import { getSession, saveSession, deleteSession } from "../services/session.js";
import config from "../config.js";
import {
  processConversation,
  normalizar,
  wantsToSendAudio,
  wantsToSendPhoto,
  isManualThanks,
  isManualAffirmative,
  isManualNegative,
  isManualNeutral,
  isManualNoProblem,
  looksLikeProblem,
  isVagueProblem,
  pick,
} from "../services/chat-core.js";

const router = Router();

// ── AI classification cache ───────────────────────────────────────
const CLS_CACHE = new Map();
const CLS_CACHE_TTL = 60_000;

async function classificar(msg) {
  const cached = CLS_CACHE.get(msg);
  if (cached && Date.now() - cached.ts < CLS_CACHE_TTL) return cached.result;

  const ai = await classificarIntencao(msg);
  if (ai) {
    CLS_CACHE.set(msg, { result: ai, ts: Date.now() });
    return ai;
  }
  return null;
}

// ── AI-assisted intent helpers ────────────────────────────────────
async function isNewIntent(msg) {
  const ai = await classificar(msg);
  if (ai === "saudacao") return true;
  const clean = msg.trim().toLowerCase();
  return ["oi","ola","opa","eai","iniciar","reiniciar","novo problema"].includes(clean);
}

async function isThanks(msg) {
  // Nunca classifica como agradecimento se a mensagem descreve um problema
  if (looksLikeProblem(msg) || isVagueProblem(msg) || isManualNegative(msg)) return false;
  const ai = await classificar(msg);
  if (ai === "agradecimento") return true;
  return isManualThanks(msg);
}

async function isAffirmativeFn(msg) {
  const ai = await classificar(msg);
  if (ai === "afirmativo") return true;
  if (ai === "negativo") return false;
  return null; // null = let core decide with sync
}

async function isNegativeFn(msg) {
  const ai = await classificar(msg);
  if (ai === "negativo") return true;
  if (ai === "afirmativo") return false;
  return null; // null = let core decide with sync
}

async function isNeutral(msg) {
  const ai = await classificar(msg);
  if (ai === "neutro") return true;
  return isManualNeutral(msg);
}

// ── Express route ─────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { message, session_id, image, contact_name, image_analysis } = req.body || {};
    if (!message || !session_id) {
      return res.status(400).send("Faltando dados");
    }

    if (typeof message !== "string") {
      return res.status(400).send("Faltando dados");
    }

    log(message);

    // Imagem válida em base64
    if (image?.trim() && image.startsWith("data:image")) {
      const respostaImagem = await analisarImagem(image);
      return res.send(respostaImagem || "Erro ao analisar imagem");
    }

    // Imagem inválida
    if (image?.trim() && !image.startsWith("data:image")) {
      return res.send(`Entendo que você quer me mostrar uma imagem 🖼️\n\nMas aqui pelo chat não dá pra receber imagem dessa forma.\n\nPode descrever o que está acontecendo? 😊`);
    }

    // Normaliza quebras de linha e espaços múltiplos antes de processar
    const msg = normalizar(message.replace(/[\r\n]+/g, " ").replace(/\s+/g, " "));

    if (msg === "reset") {
      deleteSession(session_id);
      return res.send("Memória resetada 🔄");
    }

    // Áudio — responde igual em qualquer step da conversa
    if (wantsToSendAudio(msg)) {
      return res.send(`Aqui pelo chat não consigo receber áudios 😊\n\nPode digitar o que você queria falar que te ajudo normalmente 👍`);
    }

    // Foto/imagem — responde igual em qualquer step (exceto quando é análise prévia do SAC API)
    if (!image_analysis && wantsToSendPhoto(msg)) {
      return res.send(`Ainda não consigo receber imagens por aqui 😊\n\nMas pode descrever o que aparece na tela que eu te ajudo a identificar o problema 👍`);
    }

    let session = getSession(session_id);
    const now = Date.now();

    // Agradecimento / encerramento
    if (await isThanks(msg)) {
      if (!session) {
        return res.json({ response: '', ended: true });
      }
      deleteSession(session_id);
      return res.json({
        response: pick(
          `Por nada 😊\n\nSe precisar, é só chamar! 👍`,
          `Por nada! 😄\n\nQualquer coisa, é só chamar 👍`,
          `Por nada, fico feliz em ter ajudado! 😊\n\nEstou sempre por aqui, é só chamar 👍`,
        ),
        ended: true,
      });
    }

    if (session && now - session.lastInteraction > config.sessionTimeout) {
      deleteSession(session_id);
      session = null;
    }

    // Só reseta se estiver em ask_name ou final (não no meio do atendimento)
    // Só reseta no step "final" — nunca em "ask_name" (qualquer texto é um nome válido)
    if (session && session.step === "final" && await isNewIntent(msg)) {
      deleteSession(session_id);
      session = null;
    }

    if (!session) {
      // Se o SAC já conhece o nome (via perfil WhatsApp), pré-popula para pular a pergunta
      const cleanName = contact_name && !/^\+?\d+$/.test(contact_name.trim())
        ? contact_name.split(' ')[0].charAt(0).toUpperCase() + contact_name.split(' ')[0].slice(1).toLowerCase()
        : null;
      session = { step: "start", name: cleanName, ip: null, attempts: 0, lastInteraction: now };
    }

    // Handle "neutral" catch-all before delegating
    if (!["start","ask_name","ask_problem","rag_followup","ask_ip","teach_ip","config_terminal","escalation","confirm_done","final"].includes(session.step)) {
      if (await isNeutral(msg)) {
        deleteSession(session_id);
        return res.send(`Tudo certo 👍\n\nSe precisar depois, é só chamar 😊`);
      }
      return res.send(`Se precisar de algo, estou por aqui 👍`);
    }

    // Delegate to shared core
    const { reply, session: updatedSession, shouldDelete, isTransfer } = await processConversation(
      msg,
      message,
      session,
      {
        responderComRAG,
        notificar: async () => {},
        isAffirmativeFn,
        isNegativeFn,
        chatId: session_id,
        imageAnalysis: !!image_analysis,
      },
    );

    if (shouldDelete) {
      deleteSession(session_id);
      return res.json({ response: reply, ended: true, transfer: isTransfer === true });
    }

    if (updatedSession) {
      updatedSession.lastInteraction = Date.now();
      saveSession(session_id, updatedSession);
    }

    return res.send(reply);

  } catch (err) {
    console.error("Erro no chat:", err);
    return res.status(500).send("Erro interno do servidor 😕");
  }
});

export default router;
