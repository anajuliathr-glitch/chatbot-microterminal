/**
 * ai.js — Serviço de IA com suporte a OpenRouter (grátis) e Anthropic (fallback).
 *
 * Prioridade:
 *   1. OpenRouter (OPENROUTER_API_KEY) — modelos gratuitos disponíveis
 *   2. Anthropic  (ANTHROPIC_API_KEY)  — fallback pago
 *
 * Modelo padrão OpenRouter: meta-llama/llama-4-maverick:free
 * Suporta texto + visão (imagens). 200 req/dia grátis.
 */
import Anthropic from "@anthropic-ai/sdk";
import config from "../config.js";

// ── Provider detection ────────────────────────────────────────────────
const useOpenRouter = !!config.openrouterKey;
const useAnthropic  = !!config.anthropicKey && !useOpenRouter;

let anthropic = null;
if (useAnthropic) {
  anthropic = new Anthropic({ apiKey: config.anthropicKey });
}

if (useOpenRouter) {
  console.log(`🤖 IA: OpenRouter (${config.openrouterModel})`);
} else if (useAnthropic) {
  console.log(`🤖 IA: Anthropic (${config.anthropicModel})`);
} else {
  console.warn("⚠️ IA não configurada — defina OPENROUTER_API_KEY ou ANTHROPIC_API_KEY");
}

export function isIAConfigured() {
  return useOpenRouter || useAnthropic;
}

export function getIAModel() {
  return useOpenRouter ? config.openrouterModel : config.anthropicModel;
}

// ── OpenRouter call (fetch, sem SDK extra) ────────────────────────────
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

async function openrouterCall({ model, system, userContent, max_tokens = 500 }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: userContent }); // string ou array (visão)

  const res = await fetch(OR_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://chatbot-microterminal.onrender.com",
      "X-Title": "ThR Chatbot",
    },
    body: JSON.stringify({
      model: model || config.openrouterModel,
      max_tokens,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => String(res.status));
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }

  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  // Alguns modelos colocam a resposta em `reasoning` quando `content` é null
  const text = msg?.content || msg?.reasoning?.split("\n")[0] || null;
  if (!text) throw new Error("OpenRouter retornou resposta vazia");
  return text;
}

// ── Anthropic call (fallback) ─────────────────────────────────────────
async function anthropicCall({ system, userContent, max_tokens = 500, visionParts }) {
  const content = visionParts || [{ type: "text", text: userContent }];
  const res = await anthropic.messages.create({
    model: config.anthropicModel,
    max_tokens,
    system,
    messages: [{ role: "user", content }],
  });
  return res.content[0].text;
}

// ── Generic dispatch ──────────────────────────────────────────────────
async function callIA(opts) {
  if (useOpenRouter) return openrouterCall(opts);
  return anthropicCall(opts);
}

// ── Error handling ────────────────────────────────────────────────────
function handleError(e, context = "") {
  const msg = e.message || "";
  console.error(`Erro IA${context ? " " + context : ""}:`, msg);

  if (msg.includes("401") || msg.includes("invalid") || msg.includes("Unauthorized")) {
    return "⚠️ Chave de API inválida ou expirada. Verifique OPENROUTER_API_KEY.";
  }
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("quota")) {
    return "Tive um problema técnico agora 😕\n\nMuitas requisições. Pode tentar em instantes?";
  }
  if (msg.includes("vazia") || msg.includes("empty")) {
    return null;
  }
  return null; // silencioso para RAG/classificação
}

// ── Exports públicos ──────────────────────────────────────────────────

export async function responderComIA(pergunta, contexto) {
  if (!isIAConfigured()) return "⚠️ IA não configurada";
  try {
    return await callIA({
      system: "Você é uma assistente de suporte técnico de microterminal. Responda direto e simples em português.",
      userContent: `Pergunta: ${pergunta}\n\nContexto:\n${contexto || "nenhum"}`,
      max_tokens: 800,
    });
  } catch (e) {
    return handleError(e, "responderComIA") || "⚠️ Erro ao consultar IA.";
  }
}

export async function responderComRAG(pergunta, nomePessoa) {
  if (!isIAConfigured()) return null;
  try {
    const { findRelevantChunks } = await import("./document.js");
    const contexto = findRelevantChunks(pergunta);
    if (!contexto) return null;

    const nome = nomePessoa ? `, ${nomePessoa}` : "";
    const text = await callIA({
      system: `Você é uma assistente de suporte técnico de microterminal da ThR.
Responda de forma simples, direta e amigável em português.
Use emojis com moderação.
Baseie sua resposta APENAS no contexto fornecido.
Se o contexto não for suficiente, diga que não encontrou essa informação.
Nunca invente informações técnicas.`,
      userContent: `Pergunta do usuário${nome}: "${pergunta}"\n\nContexto dos documentos:\n${contexto}`,
      max_tokens: 400,
    });

    const lower = text.toLowerCase();
    if (lower.includes("429") || lower.includes("quota") || lower.includes("rate limit")) return null;
    return text;
  } catch (e) {
    handleError(e, "RAG");
    return null;
  }
}

export async function classificarIntencao(mensagem) {
  if (!isIAConfigured()) return null;
  try {
    const text = await callIA({
      // Modelo menor e mais rápido para classificação
      model: useOpenRouter ? "openai/gpt-oss-20b:free" : undefined,
      system: "Classifique a intenção em português. Responda APENAS com uma das palavras: saudacao, afirmativo, negativo, neutro, agradecimento, problema_rede, problema_ip, reset, erro_salvamento, outro",
      userContent: mensagem,
      max_tokens: 20,
    });
    return text.trim().toLowerCase().split(/\s+/)[0]; // só a primeira palavra
  } catch (e) {
    return null;
  }
}

export async function analisarImagem(base64) {
  if (!isIAConfigured()) return "⚠️ IA de imagem não configurada";

  if (!base64?.includes("base64,")) {
    return "⚠️ Formato de imagem inválido. Por favor, descreva o problema por texto 📝";
  }

  try {
    let text;

    if (useOpenRouter) {
      text = await openrouterCall({
        model: "google/gemini-2.0-flash-exp:free",
        system: "Você é uma assistente de suporte técnico de microterminal. Analise a imagem e explique o problema de forma simples em português.",
        userContent: [
          { type: "image_url", image_url: { url: base64 } },
          { type: "text",      text: "O que tem nessa imagem? Isso indica algum erro no microterminal?" },
        ],
        max_tokens: 300,
      });
    } else {
      // Anthropic: formato próprio com source + base64
      const matches = base64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9]+);base64,(.+)$/);
      if (!matches) return "⚠️ Formato de imagem inválido. Descreva o problema por texto 📝";
      text = await anthropicCall({
        system: "Analise a imagem e explique o problema de forma simples em português.",
        userContent: null,
        max_tokens: 300,
        visionParts: [
          { type: "image", source: { type: "base64", media_type: matches[1], data: matches[2] } },
          { type: "text",  text: "O que tem nessa imagem? Isso indica algum erro no microterminal?" },
        ],
      });
    }

    return text;
  } catch (e) {
    console.error("Erro imagem:", e.message);
    if (e.message?.includes("Invalid image") || e.message?.includes("image")) {
      return "A imagem não é válida 😕\n\nPode descrever o que aparece na tela? 👍";
    }
    return "⚠️ Tive um problema ao analisar a imagem\n\nPode descrever o que está acontecendo? 😊";
  }
}
