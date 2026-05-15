import { Router } from "express";
import { sendZApiMessage } from "../services/zapi.js";
import { processMessage } from "../services/whatsapp-message.js";
import { analisarImagem } from "../services/ai.js";
import { transcribeAudio } from "../services/transcription.js";
import { getSession } from "../services/session.js";
import config from "../config.js";

const router = Router();

// Deduplicação: evita processar o mesmo webhook duas vezes
const processedMessages = new Map();
function isDuplicate(msgId) {
  if (!msgId) return false;
  if (processedMessages.has(msgId)) return true;
  processedMessages.set(msgId, Date.now());
  const cutoff = Date.now() - 120_000;
  for (const [id, ts] of processedMessages) {
    if (ts < cutoff) processedMessages.delete(id);
  }
  return false;
}

router.post("/webhook", async (req, res) => {
  res.status(200).json({ ok: true });

  try {
    const body = req.body;

    // Ignora mensagens enviadas pelo próprio bot
    if (body.fromMe) return;

    // Aceita só mensagens recebidas
    if (body.type !== "ReceivedCallback") return;

    // Normaliza número — remove @c.us, @s.whatsapp.net etc.
    if (!body.phone) return;
    const phone = String(body.phone).replace(/@.*$/, "").trim();
    if (!phone || phone === "undefined" || phone === "null") return;

    // Ignora grupos (número contém "-")
    if (phone.includes("-")) return;

    // Deduplicação por messageId
    const msgId = body.messageId || body.id || body.zaapId;
    if (isDuplicate(msgId)) {
      console.log(`⚠️ Duplicado ignorado: ${msgId}`);
      return;
    }

    const chatId = `zapi_${phone}`;

    console.log(`📥 phone:${phone} fromMe:${body.fromMe} tipo:${body.type} audio:${!!body.audio} img:${!!body.image} text:"${(body.text?.message || "").slice(0,50)}"`);

    // ── IMAGEM ──────────────────────────────────────────────
    if (body.image?.imageUrl) {
      try {
        const { default: fetch } = await import("node-fetch");
        const imgRes = await fetch(body.image.imageUrl);
        const buf   = await imgRes.arrayBuffer();
        const mime  = body.image.mimeType || "image/jpeg";
        const b64   = `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
        const reply = await analisarImagem(b64);
        await sendZApiMessage(phone, reply || "Recebi sua imagem 📸\n\nPode descrever o que está acontecendo? 😊");
      } catch (e) {
        console.error("Erro imagem:", e.message);
        await sendZApiMessage(phone, "Recebi sua imagem 📸\n\nPode descrever o que está acontecendo? 😊");
      }
      return;
    }

    // ── ÁUDIO ───────────────────────────────────────────────
    if (body.audio?.audioUrl) {
      console.log(`🎙️ Áudio de ${phone}`);
      try {
        const transcricao = await transcribeAudio(body.audio.audioUrl);
        if (transcricao) {
          console.log(`📝 Transcrição: "${transcricao}"`);
          const reply = await processMessage(transcricao, chatId, phone);
          if (reply) await sendZApiMessage(phone, `🎙️ _Entendi seu áudio:_\n"${transcricao}"\n\n${reply}`);
        } else {
          // Transcrição falhou — inicia o fluxo se for novo usuário, senão apenas pede que digite
          const sessaoExiste = getSession(chatId);
          if (!sessaoExiste) {
            // Usuário novo mandando áudio como primeira mensagem — inicia o fluxo
            const reply = await processMessage("__init__", chatId, phone);
            if (reply) {
              await sendZApiMessage(phone, reply + "\n\n_Recebi um áudio mas não consegui entender. Pode digitar? 😊_");
            }
          } else {
            await sendZApiMessage(phone, "Recebi seu áudio 🎙️\n\nMas não consegui entender. Pode digitar sua mensagem? 😊");
          }
        }
      } catch (e) {
        console.error("Erro áudio:", e.message);
        await sendZApiMessage(phone, "Recebi seu áudio 🎙️\n\nTive um problema. Pode digitar? 😊");
      }
      return;
    }

    // ── TEXTO ───────────────────────────────────────────────
    const message = body.text?.message || body.caption || "";
    if (!message.trim()) return;

    console.log(`📩 ${phone}: "${message}"`);

    const reply = await processMessage(message, chatId, phone);
    if (reply) await sendZApiMessage(phone, reply);

  } catch (e) {
    console.error("❌ Erro webhook:", e.message, e.stack?.split("\n")[1]);
  }
});

router.get("/status", (req, res) => {
  res.json({
    status: "online",
    zapi: config.zapiInstance ? "configurado" : "nao configurado",
    transcricao: config.openaiKey ? "ativa" : "inativa",
    suporte: config.supportPhone ? "configurado" : "nao configurado",
  });
});

export default router;
