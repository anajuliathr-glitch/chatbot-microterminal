/**
 * Rastreador de mensagens enviadas pelo bot.
 * Guarda IDs e hashes de conteúdo para filtrar echos do Z-API.
 *
 * O Z-API (especialmente em modo trial) reenvia webhooks para
 * mensagens que o bot enviou — esse módulo permite detectar e ignorar.
 */

const sentIds     = new Map(); // messageId  → timestamp
const sentHashes  = new Map(); // hash(text) → timestamp
const TTL = 60_000; // 60 segundos

function cleanup() {
  const cutoff = Date.now() - TTL;
  for (const [k, ts] of sentIds)    if (ts < cutoff) sentIds.delete(k);
  for (const [k, ts] of sentHashes) if (ts < cutoff) sentHashes.delete(k);
}

function hashText(text) {
  // Primeiros 80 chars normalizados — suficiente para identificar a mensagem
  return String(text).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Registra uma mensagem enviada pelo bot (chama após sendZApiMessage) */
export function trackSent(messageId, text) {
  const now = Date.now();
  if (messageId) sentIds.set(String(messageId), now);
  if (text)      sentHashes.set(hashText(text), now);
  cleanup();
}

/** Retorna true se esse webhook parece ser echo de uma mensagem do bot */
export function isEcho(messageId, text) {
  if (messageId && sentIds.has(String(messageId))) return true;
  if (text && sentHashes.has(hashText(text)))       return true;
  return false;
}
