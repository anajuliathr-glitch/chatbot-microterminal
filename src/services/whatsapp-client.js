import pkg from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import config from "../config.js";
import { processMessage } from "./whatsapp-message.js";

const { Client, LocalAuth } = pkg;

const RECONNECT_DELAYS = [5000, 15000, 30000, 60000, 120000];
const MAX_QUEUE_SIZE = 100;

let client = null;
let qrCodeData = null;
let connectionStatus = "disconnected";
let reconnectAttempt = 0;
let reconnectTimer = null;
let messageQueue = [];
let processingQueue = false;

export function getQRCode() {
  return qrCodeData;
}

export function getStatus() {
  return connectionStatus;
}

export function getClient() {
  return client;
}

export function getQueueSize() {
  return messageQueue.length;
}

export async function sendMessage(to, message) {
  if (!client || connectionStatus !== "connected") {
    throw new Error("WhatsApp não conectado");
  }
  const chatId = to.includes("@c.us") ? to : `${to}@c.us`;
  await client.sendMessage(chatId, message);
}

async function processQueue() {
  if (processingQueue || messageQueue.length === 0) return;
  processingQueue = true;

  while (messageQueue.length > 0) {
    const item = messageQueue.shift();
    try {
      const reply = await processMessage(item.messageBody, item.chatId, item.chatId);
      if (reply && client && connectionStatus === "connected") {
        await client.sendMessage(item.chatId, reply);
      }
    } catch (err) {
      console.error("Erro na fila de mensagens:", err.message);
    }
  }

  processingQueue = false;
}

function scheduleReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (reconnectAttempt >= RECONNECT_DELAYS.length) {
    console.error("❌ Número máximo de tentativas de reconexão atingido");
    connectionStatus = "dead";
    return;
  }

  const delay = RECONNECT_DELAYS[reconnectAttempt];
  console.log(`🔄 Tentando reconectar em ${delay / 1000}s (tentativa ${reconnectAttempt + 1}/${RECONNECT_DELAYS.length})...`);
  connectionStatus = "reconnecting";

  reconnectTimer = setTimeout(async () => {
    reconnectAttempt++;
    await initializeClient();
  }, delay);
}

export async function initializeClient() {
  if (client) {
    try {
      await client.destroy();
    } catch {}
    client = null;
  }

  // Localiza o Chrome dinamicamente (funciona no Render independente da versão)
  let executablePath;
  try {
    const { execSync } = await import("child_process");
    const resultado = execSync(
      "find /opt/render/.cache/puppeteer -name 'chrome' -type f 2>/dev/null | head -1"
    ).toString().trim();
    if (resultado) {
      executablePath = resultado;
      console.log("🌐 Chrome encontrado em:", executablePath);
    } else {
      console.warn("⚠️ Chrome não encontrado via find — usando padrão do Puppeteer");
    }
  } catch {
    console.warn("⚠️ Erro ao localizar Chrome — usando padrão do Puppeteer");
  }

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: config.whatsappSessionPath,
    }),
    puppeteer: {
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    },
  });

  client.on("qr", (qr) => {
    qrCodeData = qr;
    connectionStatus = "awaiting_qr";
    reconnectAttempt = 0;
    qrcode.generate(qr, { small: true });
    console.log("📱 QR Code gerado. Escaneie com o WhatsApp.");
  });

  client.on("ready", () => {
    connectionStatus = "connected";
    qrCodeData = null;
    reconnectAttempt = 0;
    console.log("✅ WhatsApp conectado!");
    processQueue();
  });

  client.on("disconnected", (reason) => {
    connectionStatus = "disconnected";
    console.log("❌ WhatsApp desconectado:", reason);
    scheduleReconnect();
  });

  client.on("auth_failure", (msg) => {
    connectionStatus = "auth_failure";
    console.error("❌ Falha de autenticação WhatsApp:", msg);
    scheduleReconnect();
  });

  client.on("message", async (msg) => {
    if (msg.from === "status@broadcast") return;
    if (msg.isGroup) return;

    const chatId = msg.from;
    const messageBody = msg.body;

    console.log(`📩 WhatsApp de ${chatId}: ${messageBody}`);

    if (messageQueue.length >= MAX_QUEUE_SIZE) {
      console.warn("⚠️ Fila de mensagens cheia, descartando mensagem de", chatId);
      return;
    }

    messageQueue.push({ chatId, messageBody });
    processQueue();
  });

  try {
    await client.initialize();
    console.log("🚀 Inicializando WhatsApp client...");
  } catch (err) {
    console.error("Erro ao inicializar WhatsApp:", err.message);
    connectionStatus = "error";
    scheduleReconnect();
  }
}

export async function closeClient() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (client) {
    try {
      await client.destroy();
    } catch {}
    client = null;
    connectionStatus = "disconnected";
  }
  messageQueue = [];
}
