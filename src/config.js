import dotenv from "dotenv";
dotenv.config();

export default {
  port: parseInt(process.env.PORT || "3001", 10),
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  sessionTimeout: (() => { const v = parseInt(process.env.SESSION_TIMEOUT || "900000", 10); return isNaN(v) ? 900000 : Math.max(60000, v); })(), // 15 min (mín 1 min, NaN-safe)
  nodeEnv: process.env.NODE_ENV || "development",
  whatsappSessionPath: process.env.WHATSAPP_SESSION_PATH || "./whatsapp-session",
  // Z-API (legado — mantido para não quebrar)
  zapiInstance: process.env.ZAPI_INSTANCE || "",
  zapiToken: process.env.ZAPI_TOKEN || "",
  zapiClientToken: process.env.ZAPI_CLIENT_TOKEN || "",
  // Meta WhatsApp Cloud API
  metaToken: process.env.META_TOKEN || "",
  metaPhoneId: process.env.META_PHONE_ID || "",
  metaVerifyToken: process.env.META_VERIFY_TOKEN || "microterminal-thr-2024",
  // Geral
  groqKey: process.env.GROQ_API_KEY || "",   // preferido para transcrição (grátis)
  openaiKey: process.env.OPENAI_API_KEY || "", // fallback legado
  openrouterKey: process.env.OPENROUTER_API_KEY || "",
  openrouterModel: process.env.OPENROUTER_MODEL || "meta-llama/llama-4-maverick:free",
  supportPhone: process.env.SUPPORT_PHONE || "",
};
