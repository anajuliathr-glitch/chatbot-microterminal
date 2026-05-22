import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import readline from "readline";
import fetch from "node-fetch";
import config from "./src/config.js";
import { loadDocuments } from "./src/services/document.js";
import { cleanExpiredSessions, close as closeSession, getSession, saveSession, deleteSession } from "./src/services/session.js";
import { startSessionWatcher } from "./src/services/session-watcher.js";
import { cleanOldLogs } from "./src/services/logger.js";
import { getStatus, getQueueSize, initializeClient } from "./src/services/whatsapp-client.js";
import { isIAConfigured, getIAModel } from "./src/services/ai.js";
import chatRouter from "./src/routes/chat.js";
import whatsappRouter from "./src/routes/whatsapp.js";
import whatsappMetaRouter from "./src/routes/whatsapp-meta.js";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors({ origin: config.corsOrigin }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 9999 : 60,
  message: "Muitas requisições. Tente novamente em 1 minuto.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

app.use("/chat", chatRouter);
app.use("/whatsapp", whatsappRouter);       // Z-API (legado)
app.use("/whatsapp-meta", whatsappMetaRouter); // Meta Cloud API

// ── Endpoints de teste (só em NODE_ENV=test) ─────────────────────────
if (process.env.NODE_ENV === "test") {
  // Seta data simulada para testes de horário comercial
  app.post("/test/set-date", (req, res) => {
    const { date } = req.body || {};
    if (date) process.env.DATE_OVERRIDE = date;
    else      delete process.env.DATE_OVERRIDE;
    res.json({ ok: true, DATE_OVERRIDE: process.env.DATE_OVERRIDE || null });
  });

  // Expira uma sessão para testar o comportamento pós-expiração
  app.post("/test/expire-session", (req, res) => {
    const { session_id } = req.body || {};
    if (!session_id) return res.status(400).json({ error: "Faltando session_id" });
    const session = getSession(session_id);
    if (!session) return res.status(404).json({ error: "Sessão não encontrada" });
    // Retroage o lastInteraction para simular expiração
    session.lastInteraction = Date.now() - (config.sessionTimeout + 60_000);
    saveSession(session_id, session);
    return res.json({ ok: true, expired: true, session_id, step: session.step });
  });

  // Deleta uma sessão diretamente (útil nos testes)
  app.post("/test/delete-session", (req, res) => {
    const { session_id } = req.body || {};
    if (!session_id) return res.status(400).json({ error: "Faltando session_id" });
    deleteSession(session_id);
    return res.json({ ok: true, deleted: true, session_id });
  });
}

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

  // Watcher de sessões: envia aviso antes de expirar (só em produção/dev)
  if (process.env.NODE_ENV !== "test") {
    startSessionWatcher();
    // Inicia cliente WhatsApp (whatsapp-web.js) — gera QR code pra escanear
    initializeClient().catch(err => console.error("Erro ao iniciar WhatsApp client:", err.message));
  }

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
    if (!input.trim()) return; // ignora linhas em branco
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
