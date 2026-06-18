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
      system: `Você é uma assistente da ThR Softwares, empresa de software de gestão.
Responda de forma simples, direta e amigável em português.
Use emojis com moderação.
Baseie sua resposta APENAS no contexto fornecido.
Se o contexto não for suficiente, diga que não encontrou essa informação e oriente a entrar em contato pelo (15) 3283-3516.
Nunca invente informações técnicas ou de produtos.`,
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
      model: useOpenRouter ? "openai/gpt-oss-20b:free" : undefined,
      system: `Classifique a intencao de uma mensagem enviada para o SAC de uma empresa de software de gestao (ThR Softwares).
Responda APENAS com uma das palavras abaixo — sem mais nada:

afirmativo   - confirma, concorda, "sim", "foi", "funcionou", "ok", "certo", "deu certo"
negativo     - nega, "nao", "nao funcionou", "nao deu", "continua igual"
agradecimento - "obrigado", "valeu", "muito obrigado"
saudacao     - "oi", "ola", "bom dia", "boa tarde"
neutro       - informacao sem contexto claro, numero, dado tecnico
escalacao    - quer falar com humano, atendente, tecnico, pessoa real
comercial    - pergunta sobre preco, produto, promocao, contrato, evento, vendas, orcamento, quanto custa, tem disponivel, quero comprar, quero adquirir, quero contratar, quero implantar, festa, salao, loja, locacao, aluguel, maquininha, tef, valor, como funciona o produto, planos, mensalidade, demonstracao, demo, franquia, royalties, franqueado, agropecuaria, agropet, petshop, racao, sementes, medicamentos veterinarios, defensivos, parque, bilheteria, catraca, ingressos, restaurante, bar, lanchonete, delivery, ifood, rappi, comanda mobile, pizzaria, hamburguer, padaria, sistema novo, novo sistema
problema_rede - terminal nao conecta, tela preta, sem conexao
problema_ip  - ip errado, nao encontrou ip, nao sabe o ip
erro_salvamento - nao salvou, nao apareceu menu, nao conseguiu pressionar P
tecnico      - qualquer outro problema tecnico com microterminal, caixa, impressora, sistema
outro        - nao se encaixa em nenhuma categoria acima`,
      userContent: mensagem,
      max_tokens: 20,
    });
    return text.trim().toLowerCase().split(/\s+/)[0];
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
      const visionModel = process.env.OPENROUTER_MODEL_VISION || "meta-llama/llama-4-maverick:free";
      text = await openrouterCall({
        model: visionModel,
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
    console.error("[analisarImagem] ERRO COMPLETO:", e.message);
    return "Recebi sua imagem! 📸\n\nPode descrever o que aparece na tela? Assim consigo te ajudar melhor 😊";
  }
}
