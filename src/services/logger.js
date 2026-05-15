import fs from "fs";
import path from "path";

const LOGS_DIR = "./logs";
const MAX_DAYS = 30; // apaga logs com mais de 30 dias

// Garante que a pasta logs/ existe
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function getLogFilePath() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOGS_DIR, `${today}.txt`);
}

export function log(message) {
  try {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(getLogFilePath(), line, "utf8");
  } catch {}
}

export function cleanOldLogs() {
  try {
    const files = fs.readdirSync(LOGS_DIR);
    const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const file of files) {
      // Só trata arquivos no formato YYYY-MM-DD.txt
      if (!/^\d{4}-\d{2}-\d{2}\.txt$/.test(file)) continue;

      const filePath = path.join(LOGS_DIR, file);
      const stat = fs.statSync(filePath);

      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`🧹 ${removed} arquivo(s) de log antigo(s) removido(s)`);
    }
  } catch (e) {
    console.error("Erro ao limpar logs antigos:", e.message);
  }
}
