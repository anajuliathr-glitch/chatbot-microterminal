import { Router } from "express";
import { sendZApiMessage } from "../services/zapi.js";
import { processMessage } from "../services/whatsapp-message.js";
import { analisarImagem } from "../services/ai.js";
import { transcribeAudio } from "../services/transcription.js";
import config from "../config.js";

const router = Router();

// Deduplicação: armazena IDs de mensagens já processadas (últimos 2 min)
const processedMessages = new Map();
function isDuplicate(msgId) {
  if (!msgId) return false;
  if (processedMessages.has(msgId)) return true;
  processedMessages.set(msgId, Date.now());
  // Limpa entradas antigas a cada chamada
  const cutoff = Date.now() - 120_000;
  for (const [id, ts] of processedMessages) {
    if (ts < cutoff) processedMessages.delete(id);
  }
  return false;
}

router.post("/webhook", async (req, res) => {
  // Responde imediatamente para o Z-API não dar timeout
  res.status(200).json({ ok: true });

  try {
    const body = req.body;

    // Ignora mensagens enviadas pelo próprio bot
    if (body.fromMe) return;

    // Aceita só mensagens recebidas
    if (body.type !== "ReceivedCallback") return;

    // Normaliza o número — remove @c.us, @s.whatsapp.net, etc.
    const phone = String(body.phone || "").replace(/@.*$/, "").trim();
    if (!phone) return;

    // Deduplicação por messageId
    const msgId = body.messageId || body.id;
    if (isDuplicate(msgId)) {
      console.log(`⚠️ Webhook duplicado ignorado: ${msgId}`);
      return;
    }

    console.log(`📥 Webhook | fromMe:${body.fromMe} tipo:${body.type} phone:${phone} msgId:${msgId} hasAudio:${!!body.audio} hasImage:${!!body.image} text:"${(body.text?.message || body.caption || "").slice(0, 60)}"`);


    // Mensagem de imagem
    if (body.image?.imageUrl) {
      try {
        const { default: fetch } = await import("node-fetch");
        const imageResponse = await fetch(body.image.imageUrl);
        const arrayBuffer = await imageResponse.arrayBuffer();
        const mimeType = body.image.mimeType || "image/jpeg";
        const base64 = `data:${mimeType};base64,${Buffer.from(arrayBuffer).toString("base64")}`;
        const reply = await analisarImagem(base64);
        await sendZApiMessage(phone, reply || "Recebi sua imagem 📸\n\nPode descrever o que está acontecendo? Assim consigo te ajudar melhor 😊");
      } catch (e) {
        console.error("Erro imagem WhatsApp:", e.message);
        await sendZApiMessage(phone, "Recebi sua imagem 📸\n\nPode descrever o que está acontecendo? 😊");
      }
      return;
    }

    // Mensagem de áudio
    if (body.audio?.audioUrl) {
      console.log(`🎙️ Áudio recebido de ${phone}`);
      try {
        const transcricao = await transcribeAudio(body.audio.audioUrl);
        if (transcricao) {
          console.log(`📝 Transcrição: "${transcricao}"`);
          const chatId = `zapi_${phone}`;
          const reply = await processMessage(transcricao, chatId, phone);
          if (reply) await sendZApiMessage(phone, `🎙️ _Entendi seu áudio:_\n"${transcricao}"\n\n${reply}`);
        } else {
          await sendZApiMessage(phone, "Recebi seu áudio 🎙️\n\nMas não consegui entender. Pode digitar sua mensagem? 😊");
        }
      } catch (e) {
        console.error("Erro áudio WhatsApp:", e.message);
        await sendZApiMessage(phone, "Recebi seu áudio 🎙️\n\nTive um problema ao processar. Pode digitar sua mensagem? 😊");
      }
      return;
    }

    // Mensagem de texto
    const message = body.text?.message || body.caption || "";
    if (!message) return;

    console.log(`📩 WhatsApp de ${phone}: ${message}`);

    const chatId = `zapi_${phone}`;
    const reply = await processMessage(message, chatId, phone);
    if (reply) await sendZApiMessage(phone, reply);

  } catch (e) {
    console.error("❌ Erro no webhook WhatsApp:", e.message, e.stack?.split("\n")[1]);
    // Não re-throw — evita crash do processo
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
