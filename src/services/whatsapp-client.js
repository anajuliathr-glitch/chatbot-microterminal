import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import { processMessage } from "./whatsapp-message.js";
import { log } from "./logger.js";
import config from "../config.js";
import path from "path";
import pino from "pino";

const SESSION_PATH = config.whatsappSessionPath || "./whatsapp-session";

let sock = null;
let qrCodeData = null;
let connectionStatus = "disconnected";
let reconnectTimer = null;
let reconnectAttempt = 0;
const MAX_RECONNECT = 20;
const RECONNECT_DELAYS = [5000, 10000, 15000, 30000, 60000, 120000];

// ── Fila de mensagens (evita race conditions) ─────────────────────
const messageQueue = [];
let processingQueue = false;

async function processQueue() {
  if (processingQueue || messageQueue.length === 0) return;
  processingQueue = true;
  while (messageQueue.length > 0) {
    const { jid, body } = messageQueue.shift();
    try {
      const chatId = `baileys_${jid.replace("@s.whatsapp.net", "")}`;
      const reply = await processMessage(body, chatId, jid);
      if (reply && sock && connectionStatus === "connected") {
        await sock.sendMessage(jid, { text: reply });
      }
    } catch (err) {
      console.error("❌ Erro na fila:", err.message);
    }
  }
  processingQueue = false;
}

// ── Exports públicos (mesma interface do cliente anterior) ────────

export function getQRCode()   { return qrCodeData; }
export function getStatus()   { return connectionStatus; }
export function getClient()   { return sock; }
export function getQueueSize(){ return messageQueue.length; }

export async function sendMessage(to, message) {
  if (!sock || connectionStatus !== "connected") {
    throw new Error("WhatsApp não conectado");
  }
  const jid = to.includes("@s.whatsapp.net") ? to : `${to}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text: message });
}

export async function closeClient() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (sock) {
    try { await sock.logout(); } catch {}
    sock = null;
  }
  connectionStatus = "disconnected";
  messageQueue.length = 0;
}

/** Força reinício da conexão — útil quando status é "dead" ou "error" */
export async function forceReconnect() {
  console.log("🔄 Force reconnect solicitado...");
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (sock) {
    try { sock.end(); } catch {}
    sock = null;
  }
  reconnectAttempt = 0;
  qrCodeData = null;
  connectionStatus = "disconnected";
  await initializeClient();
}

// ── Inicialização principal ───────────────────────────────────────

export async function initializeClient() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    console.log(`🔧 Baileys v${version.join(".")} — inicializando...`);

    sock = makeWASocket({
      version,
      auth: state,
      // Logger silencioso — só erros críticos aparecem no console
      logger: pino({ level: "silent" }),
      printQRInTerminal: true,   // QR no log do Render (fallback)
      browser: ["ThR Bot", "Chrome", "1.0.0"],
    });

    // ── Credenciais salvas ───────────────────────────────────────
    sock.ev.on("creds.update", saveCreds);

    // ── Mudança de conexão ───────────────────────────────────────
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        qrCodeData = qr;
        connectionStatus = "awaiting_qr";
        console.log("📱 QR Code gerado — acesse /whatsapp/qrcode para escanear");
      }

      if (connection === "open") {
        connectionStatus = "connected";
        qrCodeData = null;
        reconnectAttempt = 0;
        console.log("✅ WhatsApp (Baileys) conectado!");
        processQueue();
      }

      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;

        if (loggedOut) {
          console.log("🚪 Sessão encerrada (logout). Escaneie o QR novamente.");
          connectionStatus = "disconnected";
          qrCodeData = null;
          sock = null;
          // Aguarda 3s e reinicia para gerar novo QR
          setTimeout(() => initializeClient(), 3000);
          return;
        }

        connectionStatus = "disconnected";
        console.log(`❌ Desconectado (código ${code}) — tentando reconectar...`);
        scheduleReconnect();
      }
    });

    // ── Mensagens recebidas ──────────────────────────────────────
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue;                    // ignora mensagens do próprio bot
        if (msg.key.remoteJid === "status@broadcast") continue; // ignora status
        if (msg.key.remoteJid?.endsWith("@g.us")) continue;     // ignora grupos

        const jid  = msg.key.remoteJid;
        const body = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || msg.message?.imageMessage?.caption
          || "";

        if (!body.trim()) continue;

        log(`[WhatsApp/Baileys] [${jid}] ${body}`);
        console.log(`📩 ${jid}: "${body.slice(0, 60)}"`);

        messageQueue.push({ jid, body });
        processQueue();
      }
    });

  } catch (err) {
    console.error("❌ Erro ao inicializar Baileys:", err.message);
    connectionStatus = "error";
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectAttempt >= MAX_RECONNECT) {
    console.error("❌ Número máximo de tentativas de reconexão atingido");
    connectionStatus = "dead";
    return;
  }
  const delay = RECONNECT_DELAYS[reconnectAttempt] || 120000;
  console.log(`🔄 Tentando reconectar em ${delay / 1000}s (tentativa ${reconnectAttempt + 1}/${MAX_RECONNECT})...`);
  connectionStatus = "reconnecting";
  reconnectTimer = setTimeout(async () => {
    reconnectAttempt++;
    await initializeClient();
  }, delay);
}
