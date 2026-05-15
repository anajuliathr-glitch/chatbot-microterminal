import fetch from "node-fetch";
import config from "../config.js";
import { trackSent } from "./sent-tracker.js";

const ZAPI_BASE = `https://api.z-api.io/instances/${config.zapiInstance}/token/${config.zapiToken}`;

export async function sendZApiMessage(phone, message) {
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
      return;
    }

    // Registra o ID e o conteúdo da mensagem para filtrar echos
    const data = await response.json().catch(() => ({}));
    const sentId = data.messageId || data.zaapId || data.id;
    trackSent(sentId, message);

    console.log(`✅ Mensagem enviada para ${phone}${sentId ? ` (id: ${sentId})` : ""}`);
  } catch (e) {
    console.error("Erro ao enviar Z-API:", e.message);
  }
}

export async function notificarSuporte(name, phone, ip) {
  const supportPhone = config.supportPhone;
  if (!supportPhone) return;

  const msg = `🚨 *Chamado escalado para suporte*\n\n👤 Nome: ${name || "não informado"}\n📱 Número: ${phone}\n🌐 IP: ${ip || "não informado"}\n\n⚠️ O bot não conseguiu resolver após 3 tentativas.`;

  await sendZApiMessage(supportPhone, msg);
  console.log(`📢 Suporte notificado sobre chamado de ${phone}`);
}
