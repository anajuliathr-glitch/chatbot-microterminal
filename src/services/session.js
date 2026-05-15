import Database from "better-sqlite3";

// Cache em memória — garante sessão mesmo que SQLite falhe ou processo reinicie dentro da mesma instância
const memoryCache = new Map();

let db = null;
let insertStmt, getStmt, deleteStmt, cleanStmt;

try {
  db = new Database("./sessions.db");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      step TEXT NOT NULL DEFAULT 'start',
      name TEXT,
      ip TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      lastInteraction INTEGER NOT NULL,
      data TEXT
    )
  `);
  insertStmt = db.prepare(`
    INSERT OR REPLACE INTO sessions (id, step, name, ip, attempts, lastInteraction, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  getStmt    = db.prepare("SELECT * FROM sessions WHERE id = ?");
  deleteStmt = db.prepare("DELETE FROM sessions WHERE id = ?");
  cleanStmt  = db.prepare("DELETE FROM sessions WHERE lastInteraction < ?");
  console.log("✅ Banco de sessões inicializado");
} catch (e) {
  console.warn("⚠️ SQLite indisponível — usando apenas memória:", e.message);
}

const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT || "0", 10) || 180000; // mínimo 3 min

export function getSession(id) {
  // 1. Tenta memória primeiro (mais rápido e confiável dentro da mesma instância)
  if (memoryCache.has(id)) {
    return memoryCache.get(id);
  }
  // 2. Fallback para SQLite (caso processo tenha reiniciado)
  if (!db) return null;
  try {
    const row = getStmt.get(id);
    if (!row) return null;
    const session = {
      step: row.step,
      name: row.name,
      ip: row.ip,
      attempts: row.attempts,
      lastInteraction: row.lastInteraction,
      ...(row.data ? JSON.parse(row.data) : {}),
    };
    // Recarrega no cache de memória
    memoryCache.set(id, session);
    return session;
  } catch {
    return null;
  }
}

export function saveSession(id, session) {
  // Sempre salva em memória primeiro
  memoryCache.set(id, { ...session });

  // Persiste no SQLite em background (não bloqueia)
  if (!db) return;
  try {
    insertStmt.run(
      id,
      session.step || "start",
      session.name || null,
      session.ip || null,
      session.attempts || 0,
      session.lastInteraction || Date.now(),
      session.data ? JSON.stringify(session.data) : null
    );
  } catch (e) {
    console.error("Erro ao salvar sessão no SQLite:", e.message);
  }
}

export function deleteSession(id) {
  memoryCache.delete(id);
  if (!db) return;
  try {
    deleteStmt.run(id);
  } catch {}
}

export function cleanExpiredSessions() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  // Limpa memória
  for (const [id, session] of memoryCache) {
    if ((session.lastInteraction || 0) < cutoff) memoryCache.delete(id);
  }
  // Limpa SQLite
  if (!db) return;
  try {
    const result = cleanStmt.run(cutoff);
    if (result.changes > 0) console.log(`🧹 ${result.changes} sessões expiradas removidas`);
  } catch {}
}

export function close() {
  try { db?.close(); } catch {}
}
