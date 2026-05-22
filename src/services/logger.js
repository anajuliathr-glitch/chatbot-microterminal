import fs from "fs";
import path from "path";

const LOGS_DIR  = "./logs";
const MAX_DAYS  = 20;          // mantém no máximo 20 arquivos (20 dias)
const MAX_MB    = 10;          // trunca o arquivo do dia se passar de 10 MB
const MAX_BYTES = MAX_MB * 1024 * 1024;

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
    const filePath = getLogFilePath();

    // Se o arquivo do dia já passou de MAX_MB, não escreve mais (evita lotar disco)
    if (fs.existsSync(filePath)) {
      const { size } = fs.statSync(filePath);
      if (size >= MAX_BYTES) return; // silencioso — log descartado
    }

    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(filePath, line, "utf8");
  } catch {}
}

export function cleanOldLogs() {
  try {
    const files = fs
      .readdirSync(LOGS_DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.txt$/.test(f))
      .sort(); // ordem crescente → mais antigos primeiro

    let removed = 0;

    // 1. Remove por idade (mais de MAX_DAYS dias)
    const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const filePath = path.join(LOGS_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        removed++;
      }
    }

    // 2. Se ainda sobraram mais de MAX_DAYS arquivos, remove os mais antigos
    const restantes = files.filter(f => {
      const fp = path.join(LOGS_DIR, f);
      return fs.existsSync(fp);
    });
    while (restantes.length > MAX_DAYS) {
      const oldest = restantes.shift();
      fs.unlinkSync(path.join(LOGS_DIR, oldest));
      removed++;
    }

    if (removed > 0) {
      console.log(`🧹 ${removed} arquivo(s) de log antigo(s) removido(s)`);
    }
  } catch (e) {
    console.error("Erro ao limpar logs antigos:", e.message);
  }
}
