import { Router } from "express";
import { sendZApiMessage } from "../services/zapi.js";
import { processMessage } from "../services/whatsapp-message.js";
import { analisarImagem } from "../services/ai.js";
import { transcribeAudio } from "../services/transcription.js";
import config from "../config.js";

const router = Router();

router.post("/webhook", async (req, res) => {
  // Responde imediatamente para o Z-API não dar timeout
  res.status(200).json({ ok: true });

  const body = req.body;

  // Ignora mensagens enviadas pelo próprio bot
  if (body.fromMe) return;

  // Aceita só mensagens recebidas
  if (body.type !== "ReceivedCallback") return;

  const phone = body.phone;
  if (!phone) return;

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
    const transcricao = await transcribeAudio(body.audio.audioUrl);
    if (transcricao) {
      console.log(`📝 Transcrição: "${transcricao}"`);
      const chatId = `zapi_${phone}`;
      const reply = await processMessage(transcricao, chatId, phone);
      if (reply) await sendZApiMessage(phone, `🎙️ _Entendi seu áudio:_\n"${transcricao}"\n\n${reply}`);
    } else {
      await sendZApiMessage(phone, "Recebi seu áudio 🎙️\n\nMas não consegui entender. Pode digitar sua mensagem? 😊");
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
