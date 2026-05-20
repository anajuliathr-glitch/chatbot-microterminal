/**
 * Webhook da Meta WhatsApp Cloud API
 * Rota separada — convive com o webhook Z-API até a migração completa
 */
import { Router } from "express";
import { sendMetaMessage, downloadMetaMedia, notificarSuporteMeta } from "../services/meta.js";
import { processMessage } from "../services/whatsapp-message.js";
import { analisarImagem } from "../services/ai.js";
import { transcribeAudio } from "../services/transcription.js";
import { getSession } from "../services/session.js";
import config from "../config.js";

const router = Router();

// ── GET: verificação do webhook pela Meta ─────────────────────────
router.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.metaVerifyToken) {
    console.log("✅ Webhook Meta verificado com sucesso");
    return res.status(200).send(challenge);
  }
  console.warn("❌ Falha na verificação do webhook Meta");
  res.sendStatus(403);
});

// ── POST: recebe mensagens ────────────────────────────────────────
router.post("/webhook", async (req, res) => {
  // Meta exige resposta 200 imediata
  res.sendStatus(200);

  try {
    const body = req.body;

    if (body.object !== "whatsapp_business_account") return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== "messages") continue;

        const value = change.value;

        // Ignora status de entrega (delivered, read, etc.)
        if (value.statuses?.length && !value.messages?.length) continue;

        for (const msg of value.messages || []) {
          await handleMessage(msg, value.metadata).catch(e =>
            console.error("Erro ao processar mensagem Meta:", e.message)
          );
        }
      }
    }
  } catch (e) {
    console.error("❌ Erro no webhook Meta:", e.message);
  }
});

// ── Processa cada mensagem ────────────────────────────────────────
async function handleMessage(msg, metadata) {
  const phone  = msg.from; // ex: "5511999999999"
  const chatId = `meta_${phone}`;
  const msgId  = msg.id;

  console.log(`📥 Meta | de:${phone} tipo:${msg.type} id:${msgId}`);

  // ── IMAGEM ──────────────────────────────────────────────────────
  if (msg.type === "image") {
    const mediaId  = msg.image?.id;
    const caption  = msg.image?.caption || "";
    try {
      const media = await downloadMetaMedia(mediaId);
      if (media) {
        const b64   = `data:${media.mimeType};base64,${media.buffer.toString("base64")}`;
        const reply = await analisarImagem(b64);
        await sendMetaMessage(phone, reply || "Recebi sua imagem 📸\n\nPode descrever o que está acontecendo? 😊");
      } else {
        // Tenta usar o caption como mensagem de texto
        if (caption) {
          const reply = await processMessage(caption, chatId, phone);
          if (reply) await sendMetaMessage(phone, reply);
        } else {
          await sendMetaMessage(phone, `Recebi sua imagem 📸\n\nSou apenas um Bot e não consigo analisar fotos por enquanto 😊\n\nPode descrever o que aparece na tela? Assim consigo te ajudar!`);
        }
      }
    } catch (e) {
      console.error("Erro imagem Meta:", e.message);
      await sendMetaMessage(phone, `Recebi sua imagem 📸\n\nSou apenas um Bot e não consigo analisar fotos por enquanto 😊\n\nPode descrever o que aparece na tela? Assim consigo te ajudar!`);
    }
    return;
  }

  // ── ÁUDIO ───────────────────────────────────────────────────────
  if (msg.type === "audio") {
    const mediaId = msg.audio?.id;
    console.log(`🎙️ Áudio de ${phone}`);
    try {
      let transcricao = null;
      const transcKey = config.groqKey || config.openaiKey;
      if (mediaId && transcKey) {
        const media = await downloadMetaMedia(mediaId);
        if (media) {
          const useGroq = !!config.groqKey;
          const apiUrl  = useGroq
            ? "https://api.groq.com/openai/v1/audio/transcriptions"
            : "https://api.openai.com/v1/audio/transcriptions";
          const model   = useGroq ? "whisper-large-v3-turbo" : "whisper-1";

          console.log(`🎙️ Transcrevendo via ${useGroq ? "Groq (grátis)" : "OpenAI"}...`);

          const audioBlob = new Blob([media.buffer], { type: media.mimeType || "audio/ogg" });
          const formData  = new FormData();
          formData.append("file", audioBlob, "audio.ogg");
          formData.append("model", model);
          formData.append("language", "pt");

          const { default: fetch } = await import("node-fetch");
          const whisperRes = await fetch(apiUrl, {
            method: "POST",
            headers: { "Authorization": `Bearer ${transcKey}` },
            body: formData,
          });
          if (whisperRes.ok) {
            const data = await whisperRes.json();
            transcricao = data.text;
          }
        }
      }

      if (transcricao) {
        console.log(`📝 Transcrição: "${transcricao}"`);
        const reply = await processMessage(transcricao, chatId, phone);
        if (reply) await sendMetaMessage(phone, `🎙️ _Entendi seu áudio:_\n"${transcricao}"\n\n${reply}`);
      } else {
        // Inicia o fluxo se for usuário novo, senão pede que digite
        const sessaoExiste = getSession(chatId);
        if (!sessaoExiste) {
          const reply = await processMessage("__init__", chatId, phone);
          if (reply) await sendMetaMessage(phone, reply + "\n\n_Recebi um áudio mas não consegui entender. Pode digitar? 😊_");
        } else {
          await sendMetaMessage(phone, "Recebi seu áudio 🎙️\n\nMas não consegui entender. Pode digitar sua mensagem? 😊");
        }
      }
    } catch (e) {
      console.error("Erro áudio Meta:", e.message);
      await sendMetaMessage(phone, "Recebi seu áudio 🎙️\n\nTive um problema. Pode digitar? 😊");
    }
    return;
  }

  // ── VÍDEO ────────────────────────────────────────────────────────
  if (msg.type === "video") {
    await sendMetaMessage(phone, `Recebi seu vídeo 🎥\n\nSou apenas um Bot e não consigo analisar isso por enquanto 😊\n\nPode descrever em texto o que está acontecendo com o microterminal? Assim consigo te ajudar!`);
    return;
  }

  // ── DOCUMENTO ────────────────────────────────────────────────────
  if (msg.type === "document") {
    await sendMetaMessage(phone, `Recebi seu arquivo 📄\n\nSou apenas um Bot e não consigo abrir documentos por enquanto 😊\n\nPode descrever em texto o que está acontecendo? Assim consigo te ajudar!`);
    return;
  }

  // ── STICKER ──────────────────────────────────────────────────────
  if (msg.type === "sticker") {
    await sendMetaMessage(phone, `Recebi sua figurinha 😄\n\nSou apenas um Bot, então não consigo reagir direito a isso haha\n\nMe conta o que está acontecendo com o microterminal? 😊`);
    return;
  }

  // ── LOCALIZAÇÃO ──────────────────────────────────────────────────
  if (msg.type === "location") {
    await sendMetaMessage(phone, `Recebi sua localização 📍\n\nSou apenas um Bot e não consigo usar isso por enquanto 😊\n\nMe conta em texto o que está acontecendo com o microterminal?`);
    return;
  }

  // ── CONTATO ──────────────────────────────────────────────────────
  if (msg.type === "contacts") {
    await sendMetaMessage(phone, `Recebi um contato 👤\n\nSou apenas um Bot e não consigo usar isso por enquanto 😊\n\nMe conta o que está acontecendo com o microterminal?`);
    return;
  }

  // ── TEXTO ────────────────────────────────────────────────────────
  const text = msg.text?.body || "";
  if (!text.trim()) return;

  console.log(`📩 ${phone}: "${text}"`);

  const reply = await processMessage(text, chatId, phone);
  if (reply) await sendMetaMessage(phone, reply);
}

// ── Status ───────────────────────────────────────────────────────
router.get("/status", (req, res) => {
  res.json({
    status: "online",
    provider: "Meta WhatsApp Cloud API",
    configurado: config.metaToken && config.metaPhoneId ? "sim" : "nao",
    transcricao: config.openaiKey ? "ativa" : "inativa",
    suporte: config.supportPhone ? "configurado" : "nao configurado",
  });
});

export { notificarSuporteMeta };
export default router;
