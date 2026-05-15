import dotenv from "dotenv";
dotenv.config();

export default {
  port: parseInt(process.env.PORT || "3001", 10),
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  sessionTimeout: parseInt(process.env.SESSION_TIMEOUT || "180000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  whatsappSessionPath: process.env.WHATSAPP_SESSION_PATH || "./whatsapp-session",
};
