/**
 * session-watcher.js
 * Monitora sessões ativas e envia aviso ao cliente antes de expirar.
 *
 * Lógica:
 *  - Verifica a cada 60s
 *  - Se o cliente ficou sem responder por WARNING_AFTER (padrão: 10min):
 *      → manda "Ainda está aí? Sua sessão vai expirar em 5 min ⏰"
 *  - Só envia uma vez por sessão (flag warningSent)
 *  - Só envia para sessões WhatsApp ativas (não para testes/terminal)
 */

import { getAllSessions, saveSession } from "./session.js";
import { sendMetaMessage }             from "./meta.js";
import config                          from "../config.js";

const SESSION_TIMEOUT = config.sessionTimeout;          // 15min (padrão)
const WARNING_AFTER   = Math.round(SESSION_TIMEOUT * (2 / 3)); // 10min

// Steps que indicam conversa ativa (ignora 'start' e 'final')
const STEPS_ATIVOS = new Set([
  "ask_name", "ask_problem", "rag_followup",
  "ask_ip", "teach_ip", "config_terminal",
  "escalation", "confirm_done",
]);

const MSG_AVISO =
  `Oi! 😊 Ainda está por aí?\n\n` +
  `Sua sessão vai expirar em 5 minutinhos por inatividade ⏰\n\n` +
  `Se ainda estiver com algum problema no microterminal, é só me responder que continuo te ajudando! 👍`;

// ── Verifica todas as sessões ativas ─────────────────────────────────
async function checkSessions() {
  const sessions = getAllSessions();
  const now      = Date.now();

  for (const [chatId, session] of sessions) {
    // Só sessões WhatsApp Meta (ex: "meta_5511999999999")
    if (!chatId.startsWith("meta_")) continue;

    // Só conversas em andamento
    if (!STEPS_ATIVOS.has(session.step)) continue;

    // Já enviou aviso nesta sessão — pula
    if (session.warningSent) continue;

    const inativo = now - (session.lastInteraction || 0);

    // Janela de aviso: entre WARNING_AFTER e SESSION_TIMEOUT
    if (inativo >= WARNING_AFTER && inativo < SESSION_TIMEOUT) {
      const phone = chatId.replace("meta_", "");
      console.log(`⏰ Aviso de expiração → ${phone} (inativo ${Math.round(inativo / 60000)}min)`);

      // Marca antes de enviar para não enviar duplicado em caso de erro
      session.warningSent = true;
      saveSession(chatId, session);

      sendMetaMessage(phone, MSG_AVISO).catch(e =>
        console.error("Erro ao enviar aviso de expiração:", e.message)
      );
    }
  }
}

// ── Inicia o watcher ─────────────────────────────────────────────────
export function startSessionWatcher() {
  const warnMin = Math.round(WARNING_AFTER / 60_000);
  const expMin  = Math.round(SESSION_TIMEOUT / 60_000);
  console.log(`👁️  Session watcher: avisa após ${warnMin}min, sessão expira em ${expMin}min`);
  setInterval(checkSessions, 60_000); // verifica a cada 1 min
}
