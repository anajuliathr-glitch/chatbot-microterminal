import Anthropic from "@anthropic-ai/sdk";
import config from "../config.js";

let anthropic = null;

if (config.anthropicKey) {
  anthropic = new Anthropic({ apiKey: config.anthropicKey });
} else {
  console.warn("⚠️ ANTHROPIC_API_KEY não definida");
}

function safeResponse(res) {
  if (!res) return null;
  const txt = res.toLowerCase();
  if (
    txt.includes("429") ||
    txt.includes("quota") ||
    txt.includes("rate limit") ||
    txt.includes("exceeded")
  ) {
    return "Tive um problema técnico agora 😕\n\nPode tentar novamente daqui a pouco?";
  }
  return res;
}

export function isIAConfigured() {
  return !!anthropic;
}

export function getIAModel() {
  return config.anthropicModel;
}

function handleAIError(e) {
  const status = e.status || e.message;
  if (status === 401) {
    return "⚠️ A chave da API de IA está inválida ou expirou. Peça ao administrador para gerar uma nova chave em https://console.anthropic.com/.";
  }
  if (status === 429 || e.message?.includes("quota") || e.message?.includes("rate limit")) {
    return "Tive um problema técnico agora 😕\n\nMuitas requisições seguidas. Pode tentar novamente daqui a pouco?";
  }
  if (status === 400 && e.message?.includes("model")) {
    return "⚠️ O modelo de IA configurado não está mais disponível. O administrador precisa atualizar ANTHROPIC_MODEL no .env.";
  }
  return "⚠️ Erro ao consultar IA. Verifique a chave API e o modelo configurados.";
}

export async function responderComIA(pergunta, contexto) {
  try {
    if (!anthropic) return "⚠️ IA não configurada (faltando ANTHROPIC_API_KEY)";

    const resposta = await anthropic.messages.create({
      model: config.anthropicModel,
      max_tokens: 1000,
      system: "Você é uma assistente de suporte técnico de microterminal. Responda direto e simples.",
      messages: [
        {
          role: "user",
          content: `Pergunta: ${pergunta}\n\nContexto:\n${contexto || "nenhum"}`,
        },
      ],
    });

    return resposta.content[0].text;
  } catch (e) {
    console.error("Erro IA:", e.message, e.status, e.stack?.split("\n")[1]);
    return handleAIError(e);
  }
}

export async function responderComRAG(pergunta, nomePessoa) {
  try {
    if (!anthropic) return null;

    const { findRelevantChunks } = await import("./document.js");
    const contexto = findRelevantChunks(pergunta);

    if (!contexto) return null;

    const nome = nomePessoa ? `, ${nomePessoa}` : "";

    const resposta = await anthropic.messages.create({
      model: config.anthropicModel,
      max_tokens: 400,
      system: `Você é uma assistente de suporte técnico de microterminal da ThR.
Responda de forma simples, direta e amigável em português.
Use emojis com moderação.
Baseie sua resposta APENAS no contexto fornecido.
Se o contexto não for suficiente para responder, diga que não encontrou essa informação e peça para o usuário descrever melhor.
Nunca invente informações técnicas.`,
      messages: [
        {
          role: "user",
          content: `Pergunta do usuário${nome}: "${pergunta}"

Contexto encontrado nos documentos:
${contexto}`,
        },
      ],
    });

    return safeResponse(resposta.content[0].text);
  } catch (e) {
    console.error("Erro RAG:", e.message, e.status);
    return null;
  }
}

export async function classificarIntencao(mensagem) {
  try {
    if (!anthropic) return null;

    const resposta = await anthropic.messages.create({
      model: config.anthropicModel,
      max_tokens: 50,
      system: "Classifique a intenção do usuário em português. Responda APENAS com uma das palavras: saudacao, afirmativo, negativo, neutro, agradecimento, problema_rede, problema_ip, reset, erro_salvamento, outro",
      messages: [{ role: "user", content: mensagem }],
    });

    return resposta.content[0].text.trim().toLowerCase();
  } catch (e) {
    return null;
  }
}

export async function analisarImagem(base64) {
  try {
    if (!anthropic) return "⚠️ IA de imagem não configurada";

    if (!base64 || !base64.includes("base64,")) {
      return "⚠️ Formato de imagem inválido. Por favor, descreva o problema por texto 📝";
    }

    const matches = base64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9]+);base64,(.+)$/);
    if (!matches) {
      return "⚠️ Formato de imagem inválido. Por favor, descreva o problema por texto 📝";
    }

    const mediaType = matches[1];
    const imageData = matches[2];

    const resposta = await anthropic.messages.create({
      model: config.anthropicModel,
      max_tokens: 300,
      system: "Você é uma assistente de suporte técnico de microterminal. Analise a imagem e explique o problema de forma simples e direta em português.",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageData } },
            { type: "text", text: "O que tem nessa imagem? Isso indica algum erro no microterminal?" },
          ],
        },
      ],
    });

    return resposta.content[0].text;
  } catch (e) {
    console.error("Erro imagem:", e.message);
    if (e.message?.includes("Invalid image")) {
      return "A imagem não é válida ou está corrompida 😕\n\nPode tentar descrever o problema? Assim fico mais rápido em ajudar 👍";
    }
    return "⚠️ Tive um problema ao analisar a imagem\n\nPode descrever o que está acontecendo em texto? 😊";
  }
}
