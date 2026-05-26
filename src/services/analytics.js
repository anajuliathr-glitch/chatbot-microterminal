/**
 * analytics.js — Structured event logger for the ThR chatbot analytics dashboard.
 * Writes JSON Lines to logs/analytics-YYYY-MM-DD.jsonl
 */
import fs from "fs";
import path from "path";

const LOGS_DIR = "./logs";

function getAnalyticsPath() {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(LOGS_DIR, `analytics-${today}.jsonl`);
}

export function logEvent(event) {
  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
    fs.appendFileSync(getAnalyticsPath(), line, "utf8");
  } catch {}
}
