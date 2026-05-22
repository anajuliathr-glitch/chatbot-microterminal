import { Router } from "express";
import { sendZApiMessage } from "../services/zapi.js";
import { processMessage } from "../services/whatsapp-message.js";
import { analisarImagem } from "../services/ai.js";
import { transcribeAudio } from "../services/transcription.js";
import { getSession } from "../services/session.js";
import { isEcho } from "../services/sent-tracker.js";
import { getQRCode, getStatus } from "../services/whatsapp-client.js";
import config from "../config.js";

const router = Router();

// ── Deduplicação por messageId (evita processar o mesmo webhook 2x) ──
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

// ── Lock por chatId (evita race condition entre webhooks simultâneos) ──
const sessionLocks = new Map();
async function withLock(chatId, fn) {
  while (sessionLocks.get(chatId)) {
    await new Promise(r => setTimeout(r, 15));
  }
  sessionLocks.set(chatId, true);
  try {
    return await fn();
  } finally {
    sessionLocks.delete(chatId);
  }
}

// ── Frases que identificam mensagem enviada pelo próprio bot (echo Z-API trial) ──
const BOT_ECHO_MARKERS = [
  "conta em trial",
  "favor desconsiderar",
  "corpo da mensagem enviada",
  "mensagem de teste",
];

function isBotEcho(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return BOT_ECHO_MARKERS.some(m => lower.includes(m));
}

router.post("/webhook", async (req, res) => {
  res.status(200).json({ ok: true });

  try {
    const body = req.body;

    // 1. Ignora mensagens enviadas pelo próprio bot
    if (body.fromMe) return;

    // 2. Aceita só ReceivedCallback
    if (body.type !== "ReceivedCallback") return;

    // 3. Normaliza número
    if (!body.phone) return;
    const phone = String(body.phone).replace(/@.*$/, "").trim();
    if (!phone || phone === "undefined" || phone === "null") return;

    // 4. Ignora grupos
    if (phone.includes("-")) return;

    // 5. Deduplicação
    const msgId = body.messageId || body.id || body.zaapId;
    if (isDuplicate(msgId)) {
      console.log(`⚠️ Duplicado ignorado: ${msgId}`);
      return;
    }

    const rawText = body.text?.message || body.caption || "";

    // 6. Bloqueia echo do bot — verifica por messageId E por conteúdo
    if (isEcho(msgId, rawText)) {
      console.log(`🚫 Echo do bot bloqueado | id:${msgId} | "${rawText.slice(0, 50)}"`);
      return;
    }

    // 6b. Fallback: watermark do Z-API trial no texto
    if (isBotEcho(rawText)) {
      console.log(`🚫 Echo por watermark bloqueado: "${rawText.slice(0, 50)}"`);
      return;
    }

    console.log(`📥 phone:${phone} fromMe:${body.fromMe} audio:${!!body.audio} img:${!!body.image} text:"${rawText.slice(0, 60)}"`);

    const chatId = `zapi_${phone}`;

    // ── IMAGEM ────────────────────────────────────────────────
    if (body.image?.imageUrl) {
      await withLock(chatId, async () => {
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
      });
      return;
    }

    // ── ÁUDIO ─────────────────────────────────────────────────
    if (body.audio?.audioUrl) {
      console.log(`🎙️ Áudio de ${phone}`);
      await withLock(chatId, async () => {
        try {
          const transcricao = await transcribeAudio(body.audio.audioUrl);
          if (transcricao) {
            console.log(`📝 Transcrição: "${transcricao}"`);
            const reply = await processMessage(transcricao, chatId, phone);
            if (reply) await sendZApiMessage(phone, `🎙️ _Entendi seu áudio:_\n"${transcricao}"\n\n${reply}`);
          } else {
            const sessaoExiste = getSession(chatId);
            if (!sessaoExiste) {
              const reply = await processMessage("__init__", chatId, phone);
              if (reply) await sendZApiMessage(phone, reply + "\n\n_Recebi um áudio mas não consegui entender. Pode digitar? 😊_");
            } else {
              await sendZApiMessage(phone, "Recebi seu áudio 🎙️\n\nMas não consegui entender. Pode digitar? 😊");
            }
          }
        } catch (e) {
          console.error("Erro áudio:", e.message);
          await sendZApiMessage(phone, "Recebi seu áudio 🎙️\n\nTive um problema. Pode digitar? 😊");
        }
      });
      return;
    }

    // ── TEXTO ─────────────────────────────────────────────────
    const message = rawText.trim();
    if (!message) return;

    console.log(`📩 ${phone}: "${message}"`);

    await withLock(chatId, async () => {
      const reply = await processMessage(message, chatId, phone);
      if (reply) await sendZApiMessage(phone, reply);
    });

  } catch (e) {
    console.error("❌ Erro webhook:", e.message, e.stack?.split("\n")[1]);
  }
});

router.get("/status", (req, res) => {
  res.json({
    status: "online",
    whatsapp: getStatus(),
    zapi: config.zapiInstance ? "configurado" : "nao configurado",
    transcricao: config.openaiKey ? "ativa" : "inativa",
    suporte: config.supportPhone ? "configurado" : "nao configurado",
  });
});

// ── QR Code para escanear com o WhatsApp ────────────────────────────
router.get("/qrcode", (req, res) => {
  const status = getStatus();

  if (status === "connected") {
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>✅ WhatsApp já está conectado!</h2>
        <p>O bot está online e pronto pra atender.</p>
      </body></html>
    `);
  }

  const qr = getQRCode();
  if (!qr) {
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>⏳ Aguardando QR Code...</h2>
        <p>O servidor ainda está inicializando. Aguarde alguns segundos e <a href="/whatsapp/qrcode">atualize a página</a>.</p>
        <p>Status atual: <strong>${status}</strong></p>
      </body></html>
    `);
  }

  // Exibe QR code usando API externa (sem precisar de pacote extra)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
  res.send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>📱 Escaneie com o WhatsApp</h2>
      <p>Abra o WhatsApp → <strong>Aparelhos conectados</strong> → <strong>Conectar aparelho</strong></p>
      <img src="${qrUrl}" style="margin:20px auto;display:block;border:1px solid #ccc;padding:10px;border-radius:8px"/>
      <p style="color:#888">O QR code expira em 20 segundos — se não funcionar, <a href="/whatsapp/qrcode">atualize a página</a></p>
    </body></html>
  `);
});

export default router;
