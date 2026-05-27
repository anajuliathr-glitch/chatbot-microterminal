/**
 * analytics.js — Persistent analytics event logger.
 *
 * Storage strategy (in order of priority):
 *   1. Upstash Redis (se UPSTASH_REDIS_REST_URL + TOKEN estiverem no env)
 *      → dados persistem entre deploys no Render ✅
 *   2. Arquivo JSONL local (fallback — perde dados no redeploy ⚠️)
 *
 * Para configurar Upstash:
 *   - Crie conta grátis em upstash.com
 *   - Crie um banco Redis (free tier)
 *   - Adicione no Render: UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.resolve(__dirname, "../../logs");

// ── Upstash Redis ─────────────────────────────────────────────────────
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = !!(UPSTASH_URL && UPSTASH_TOKEN);

if (USE_REDIS) {
  console.log("📊 Analytics: usando Upstash Redis (dados persistentes)");
} else {
  console.log("📊 Analytics: usando arquivo local (dados perdem no redeploy — configure Upstash para persistir)");
}

async function redisCmd(...args) {
  const res = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  return data.result;
}

function dateKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── File system fallback ──────────────────────────────────────────────
function ensureDir() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function getFilePath(dateStr) {
  return path.join(LOGS_DIR, `analytics-${dateStr}.jsonl`);
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Log a structured analytics event (fire-and-forget).
 * @param {object} event — Any object; `ts` is added automatically.
 */
export function logEvent(event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });

  if (USE_REDIS) {
    const key = `analytics:${dateKey()}`;
    // fire-and-forget — never blocks the bot
    redisCmd("LPUSH", key, line)
      .then(() => redisCmd("EXPIRE", key, 8 * 24 * 3600)) // 8 days TTL
      .catch(() => {});
    return;
  }

  // File system fallback
  try {
    ensureDir();
    fs.appendFileSync(getFilePath(dateKey()), line + "\n", "utf8");
  } catch { /* never crash */ }
}

/**
 * Read all analytics events from the last `days` days.
 * @param {number} days
 * @returns {Promise<Array<object>>}
 */
export async function readEvents(days = 7) {
  if (USE_REDIS) {
    const events = [];
    for (let i = 0; i < days; i++) {
      try {
        const lines = await redisCmd("LRANGE", `analytics:${dateKey(i)}`, 0, -1);
        if (Array.isArray(lines)) {
          for (const line of lines) {
            try { events.push(JSON.parse(line)); } catch {}
          }
        }
      } catch {}
    }
    return events;
  }

  // File system fallback (sync)
  const events = [];
  try {
    ensureDir();
    for (let i = 0; i < days; i++) {
      const filePath = getFilePath(dateKey(i));
      if (!fs.existsSync(filePath)) continue;
      const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        try { events.push(JSON.parse(line)); } catch {}
      }
    }
  } catch {}
  return events;
}
