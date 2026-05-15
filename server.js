import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import readline from "readline";
import fetch from "node-fetch";
import config from "./src/config.js";
import { loadDocuments } from "./src/services/document.js";
import { cleanExpiredSessions, close as closeSession } from "./src/services/session.js";
import { cleanOldLogs } from "./src/services/logger.js";
import { getStatus, getQueueSize } from "./src/services/whatsapp-client.js";
import { isIAConfigured, getIAModel } from "./src/services/ai.js";
import chatRouter from "./src/routes/chat.js";
import whatsappRouter from "./src/routes/whatsapp.js";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors({ origin: config.corsOrigin }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: "Muitas requisições. Tente novamente em 1 minuto.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

app.use("/chat", chatRouter);
app.use("/whatsapp", whatsappRouter);

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "v3",
    ai: {
      configured: isIAConfigured(),
      model: getIAModel(),
    },
    whatsapp: getStatus(),
    queue: getQueueSize(),
    webhook: "/whatsapp/webhook",
    qrcode: "/whatsapp/qrcode",
    chat: "/chat",
  });
});

process.on("uncaughtException", (err) => {
  console.error("❌ Erro não tratado:", err.message);
});

process.on("unhandledRejection", (err) => {
  console.error("❌ Promise rejeitada:", err.message);
});

async function start() {
  await loadDocuments();

  setInterval(cleanExpiredSessions, 30 * 60 * 1000);

  // Limpeza de logs antigos: roda no startup e depois 1x por dia
  cleanOldLogs();
  setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const session_id = "terminal_" + Date.now();

  async function sendMessage(message) {
    try {
      const res = await fetch(`http://localhost:${config.port}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, session_id }),
      });
      const text = await res.text();
      console.log("\n🤖 " + text + "\n");
    } catch (e) {
      console.error("Erro:", e.message);
    }
  }

  console.log("\n💬 Assistente Microterminal iniciado");
  console.log(`🌐 http://localhost:${config.port}`);
  console.log("📱 Webhook WhatsApp: POST /whatsapp/webhook");
  console.log("Digite sua mensagem (ou 'sair'):\n");

  rl.on("line", async (input) => {
    if (input.toLowerCase() === "sair") {
      console.log("Encerrando...");
      closeSession();
      process.exit();
    }
    await sendMessage(input);
  });

  app.listen(config.port, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${config.port}`);
  });
}

start().catch(console.error);
