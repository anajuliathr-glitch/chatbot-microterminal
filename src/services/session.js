import Database from "better-sqlite3";
import config from "../config.js";

const db = new Database("./sessions.db");
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

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO sessions (id, step, name, ip, attempts, lastInteraction, data)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const getStmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
const deleteStmt = db.prepare("DELETE FROM sessions WHERE id = ?");
const cleanStmt = db.prepare("DELETE FROM sessions WHERE lastInteraction < ?");

const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;

export function getSession(id) {
  try {
    const row = getStmt.get(id);
    if (!row) return null;
    return {
      step: row.step,
      name: row.name,
      ip: row.ip,
      attempts: row.attempts,
      lastInteraction: row.lastInteraction,
      ...(row.data ? JSON.parse(row.data) : {}),
    };
  } catch {
    return null;
  }
}

export function saveSession(id, session) {
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
    console.error("Erro ao salvar sessão:", e.message);
  }
}

export function deleteSession(id) {
  try {
    deleteStmt.run(id);
  } catch {}
}

export function cleanExpiredSessions() {
  try {
    const cutoff = Date.now() - CLEANUP_INTERVAL;
    const result = cleanStmt.run(cutoff);
    if (result.changes > 0) {
      console.log(`🧹 ${result.changes} sessões expiradas removidas`);
    }
  } catch {}
}

export function close() {
  db.close();
}
