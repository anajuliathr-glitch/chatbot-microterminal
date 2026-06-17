/**
 * Sessões persistidas no Upstash Redis — sobrevivem a restarts do Render.
 * Cache em memória para velocidade dentro da mesma instância.
 */

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24h

const memoryCache = new Map();

function key(id) { return `session:${id}`; }

async function redisCall(method, ...args) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const url = `${REDIS_URL}/${[method, ...args.map(a => encodeURIComponent(JSON.stringify(a)))].join('/')}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.result ?? null;
  } catch { return null; }
}

export async function getSessionAsync(id) {
  if (memoryCache.has(id)) return memoryCache.get(id);
  const raw = await redisCall('GET', key(id));
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    memoryCache.set(id, session);
    return session;
  } catch { return null; }
}

export async function saveSessionAsync(id, session) {
  memoryCache.set(id, { ...session });
  await redisCall('SETEX', key(id), SESSION_TTL_SECONDS, JSON.stringify(session));
}

export async function deleteSessionAsync(id) {
  memoryCache.delete(id);
  await redisCall('DEL', key(id));
}

// Compatibilidade síncrona (só memória) — usada em contextos não-async
export function getSession(id) { return memoryCache.get(id) ?? null; }
export function saveSession(id, session) { memoryCache.set(id, { ...session }); saveSessionAsync(id, session); }
export function deleteSession(id) { memoryCache.delete(id); deleteSessionAsync(id); }

export function getAllSessions() { return new Map(memoryCache); }
export function cleanExpiredSessions() {
  const cutoff = Date.now() - SESSION_TTL_SECONDS * 1000;
  for (const [id, s] of memoryCache) {
    if ((s.lastInteraction || 0) < cutoff) memoryCache.delete(id);
  }
}
export function close() {}
