import { Router } from "express";
import fetch from "node-fetch";
import config from "../config.js";
import { processMessage } from "../services/whatsapp-message.js";
import { analisarImagem } from "../services/ai.js";

const router = Router();

const ZAPI_BASE = `https://api.z-api.io/instances/${config.zapiInstance}/token/${config.zapiToken}`;

async function sendZApiMessage(phone, message) {
  try {
    const response = await fetch(`${ZAPI_BASE}/send-text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": config.zapiClientToken,
      },
      body: JSON.stringify({ phone, message }),
    });
    if (!response.ok) {
      console.error("Erro Z-API envio:", await response.text());
    } else {
      console.log(`✅ Mensagem enviada para ${phone}`);
    }
  } catch (e) {
    console.error("Erro ao enviar Z-API:", e.message);
  }
}

router.post("/webhook", async (req, res) => {
  // Responde imediatamente para o Z-API não dar timeout
  res.status(200).json({ ok: true });

  const body = req.body;

  // Ignora mensagens enviadas pelo próprio bot
  if (body.fromMe) return;

  // Aceita só mensagens recebidas
  if (body.type !== "ReceivedCallback") return;

  const phone = body.phone;

  // Mensagem de imagem
  if (body.image?.imageUrl) {
    try {
      const imageResponse = await fetch(body.image.imageUrl);
      const arrayBuffer = await imageResponse.arrayBuffer();
      const mimeType = body.image.mimeType || "image/jpeg";
      const base64 = `data:${mimeType};base64,${Buffer.from(arrayBuffer).toString("base64")}`;
      const reply = await analisarImagem(base64);
      if (reply) await sendZApiMessage(phone, reply);
    } catch (e) {
      console.error("Erro imagem WhatsApp:", e.message);
      await sendZApiMessage(phone, "Recebi sua imagem 📸\n\nPode descrever o que está acontecendo? Assim consigo te ajudar melhor 😊");
    }
    return;
  }

  const message = body.text?.message || body.caption || "";
  if (!phone || !message) return;

  console.log(`📩 WhatsApp de ${phone}: ${message}`);

  const chatId = `zapi_${phone}`;
  const reply = await processMessage(message, chatId, phone);

  if (reply) {
    await sendZApiMessage(phone, reply);
  }
});

router.get("/status", (req, res) => {
  res.json({
    status: "online",
    zapi: config.zapiInstance ? "configurado" : "nao configurado",
  });
});

export default router;
