/**
 * Serviço de envio de mensagens via Meta WhatsApp Cloud API
 * Substitui o Z-API sem watermark e sem custo adicional
 */
import fetch from "node-fetch";
import config from "../config.js";

const BASE = "https://graph.facebook.com/v19.0";

/**
 * Envia mensagem de texto para um número
 * @param {string} to  Número no formato 5511999999999
 * @param {string} text Texto da mensagem
 */
export async function sendMetaMessage(to, text) {
  try {
    const res = await fetch(`${BASE}/${config.metaPhoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.metaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Erro Meta API:", JSON.stringify(data));
      return null;
    }

    const msgId = data.messages?.[0]?.id;
    console.log(`✅ Mensagem enviada para ${to} (id: ${msgId})`);
    return msgId;
  } catch (e) {
    console.error("Erro ao enviar via Meta:", e.message);
    return null;
  }
}

/**
 * Baixa mídia (áudio/imagem) da Meta API e retorna como Buffer
 * @param {string} mediaId  ID da mídia vindo do webhook
 */
export async function downloadMetaMedia(mediaId) {
  try {
    // 1. Pega a URL temporária da mídia
    const infoRes = await fetch(`${BASE}/${mediaId}`, {
      headers: { "Authorization": `Bearer ${config.metaToken}` },
    });
    const info = await infoRes.json();
    if (!info.url) throw new Error("URL de mídia não encontrada");

    // 2. Baixa o arquivo
    const fileRes = await fetch(info.url, {
      headers: { "Authorization": `Bearer ${config.metaToken}` },
    });
    if (!fileRes.ok) throw new Error("Falha ao baixar mídia");

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    return { buffer, mimeType: info.mime_type };
  } catch (e) {
    console.error("Erro ao baixar mídia Meta:", e.message);
    return null;
  }
}

/**
 * Notifica o suporte humano sobre um chamado escalado
 */
export async function notificarSuporteMeta(name, phone, ip) {
  const supportPhone = config.supportPhone;
  if (!supportPhone) return;

  const msg = `🚨 *Chamado escalado para suporte*\n\n👤 Nome: ${name || "não informado"}\n📱 Número: ${phone}\n🌐 IP: ${ip || "não informado"}\n\n⚠️ O bot não conseguiu resolver após 3 tentativas.`;

  await sendMetaMessage(supportPhone, msg);
  console.log(`📢 Suporte notificado sobre chamado de ${phone}`);
}
