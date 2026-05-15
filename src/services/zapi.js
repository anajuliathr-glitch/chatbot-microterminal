import fetch from "node-fetch";
import config from "../config.js";

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
    } else {
      console.log(`✅ Mensagem enviada para ${phone}`);
    }
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
