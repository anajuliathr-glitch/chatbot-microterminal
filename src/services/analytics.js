/**
 * analytics.js — Fire-and-forget JSONL event logger.
 * Writes one JSON object per line to logs/analytics-YYYY-MM-DD.jsonl
 * Never throws — failure is silently swallowed so it never crashes the bot.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.resolve(__dirname, "../../logs");

function getAnalyticsPath() {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOGS_DIR, `analytics-${date}.jsonl`);
}

function ensureDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Log a structured analytics event (fire-and-forget).
 * @param {object} event — Any object; `ts` is added automatically.
 */
export function logEvent(event) {
  try {
    ensureDir();
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
    fs.appendFileSync(getAnalyticsPath(), line, "utf8");
  } catch {
    // Never crash the main flow
  }
}

/**
 * Read all analytics events from the last `days` days.
 * @param {number} days
 * @returns {Array<object>}
 */
export function readEvents(days = 7) {
  const events = [];
  try {
    ensureDir();
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const filePath = path.join(LOGS_DIR, `analytics-${dateStr}.jsonl`);
      if (!fs.existsSync(filePath)) continue;
      const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        try { events.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
    }
  } catch { /* ignore */ }
  return events;
}
