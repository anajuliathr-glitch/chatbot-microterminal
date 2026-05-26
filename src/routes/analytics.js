/**
 * analytics.js — Dashboard route for the ThR chatbot analytics.
 * Serves a password-protected HTML dashboard at GET /analytics
 */
import { Router } from "express";
import { readEvents } from "../services/analytics.js";

const router = Router();

const PASSWORD = process.env.ANALYTICS_PASSWORD || "thr2024";
const COOKIE_NAME = "thr_analytics_auth";
const COOKIE_MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours

// ── Auth middleware ───────────────────────────────────────────────────
function isAuthenticated(req) {
  const raw = req.headers.cookie || "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match && match[1] === PASSWORD;
}

// ── Process raw events into dashboard metrics ─────────────────────────
function processAnalytics(events) {
  const today = new Date().toISOString().slice(0, 10);

  // Per-day counts (last 7 days)
  const dayMap = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayMap[d.toISOString().slice(0, 10)] = { sessions: 0, messages: 0, resolved: 0, escalations: 0 };
  }

  // Per-session tracking
  const sessions = {}; // chatId → { maxStep, steps[] }
  const clarifications = []; // last 20 msgs bot didn't understand

  let todaySessions = 0, todayMessages = 0, todayResolved = 0, todayEscalations = 0;

  const STEP_ORDER = ["start","ask_name","ask_problem","rag_followup","ask_ip","teach_ip","config_terminal","escalation","confirm_done","final"];

  for (const ev of events) {
    const day = ev.ts ? ev.ts.slice(0, 10) : null;
    if (!day || !dayMap[day]) continue;

    switch (ev.type) {
      case "session_start":
        dayMap[day].sessions++;
        if (day === today) todaySessions++;
        if (!sessions[ev.chatId]) sessions[ev.chatId] = { maxStepIdx: 0, name: ev.name };
        break;

      case "message":
        dayMap[day].messages++;
        if (day === today) todayMessages++;
        break;

      case "step_change":
        if (ev.chatId && ev.to) {
          const idx = STEP_ORDER.indexOf(ev.to);
          if (!sessions[ev.chatId]) sessions[ev.chatId] = { maxStepIdx: 0 };
          if (idx > sessions[ev.chatId].maxStepIdx) sessions[ev.chatId].maxStepIdx = idx;
        }
        break;

      case "resolved":
        dayMap[day].resolved++;
        if (day === today) todayResolved++;
        break;

      case "escalation":
        dayMap[day].escalations++;
        if (day === today) todayEscalations++;
        break;

      case "clarification":
        if (ev.msg && ev.msg.length > 1) {
          clarifications.push({ ts: ev.ts, msg: ev.msg.slice(0, 120), chatId: ev.chatId });
        }
        break;
    }
  }

  // Step funnel — how many sessions reached each step
  const funnel = STEP_ORDER.map((step, idx) => ({
    step,
    count: Object.values(sessions).filter(s => s.maxStepIdx >= idx).length,
  }));

  const last20Clarifications = clarifications.slice(-20).reverse();

  const days = Object.entries(dayMap).map(([date, d]) => ({ date, ...d }));

  const totalSessions = Object.keys(sessions).length;
  const resolveRate = totalSessions > 0
    ? Math.round((days.reduce((a, d) => a + d.resolved, 0) / totalSessions) * 100)
    : 0;

  return {
    today: { sessions: todaySessions, messages: todayMessages, resolved: todayResolved, escalations: todayEscalations },
    days,
    funnel,
    clarifications: last20Clarifications,
    resolveRate,
    totalSessions,
  };
}

// ── HTML dashboard builder ────────────────────────────────────────────
function buildHTML(data) {
  const { today, days, funnel, clarifications, resolveRate, totalSessions } = data;

  const maxDayCount = Math.max(...days.map(d => d.sessions), 1);

  const dayBars = days.map(d => {
    const pct = Math.round((d.sessions / maxDayCount) * 100);
    const label = d.date.slice(5); // MM-DD
    return `
      <div class="bar-group">
        <div class="bar-wrap">
          <div class="bar" style="height:${pct}%" title="${d.sessions} sessões">
            ${d.sessions > 0 ? `<span class="bar-val">${d.sessions}</span>` : ""}
          </div>
        </div>
        <div class="bar-label">${label}</div>
        <div class="bar-sub">✔${d.resolved} ⚠${d.escalations}</div>
      </div>`;
  }).join("");

  const funnelMax = funnel[0]?.count || 1;
  const funnelRows = funnel.map(f => {
    const pct = Math.round((f.count / funnelMax) * 100);
    const label = f.step.replace(/_/g, " ");
    return `
      <div class="funnel-row">
        <div class="funnel-step">${label}</div>
        <div class="funnel-bar-wrap">
          <div class="funnel-bar" style="width:${pct}%"></div>
        </div>
        <div class="funnel-count">${f.count}</div>
      </div>`;
  }).join("");

  const clarRows = clarifications.length === 0
    ? `<tr><td colspan="3" style="text-align:center;color:#666;padding:20px">Nenhuma mensagem sem resposta 🎉</td></tr>`
    : clarifications.map(c => {
        const time = c.ts ? c.ts.slice(11, 16) + " " + c.ts.slice(0, 10) : "";
        const safeMsg = c.msg.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const id = (c.chatId || "").slice(-8);
        return `<tr><td>${time}</td><td>${id}</td><td>${safeMsg}</td></tr>`;
      }).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ThR Chatbot — Analytics</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh}
  header{background:#1a1f2e;border-bottom:1px solid #2d3748;padding:16px 24px;display:flex;align-items:center;gap:12px}
  header h1{font-size:18px;font-weight:600;color:#fff}
  header .badge{background:#3182ce;color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600}
  .refresh-note{margin-left:auto;font-size:12px;color:#718096}
  main{max-width:1200px;margin:0 auto;padding:24px}
  .section-title{font-size:13px;font-weight:600;color:#718096;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px}
  /* ── Stat cards ── */
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:28px}
  .card{background:#1a1f2e;border:1px solid #2d3748;border-radius:8px;padding:16px 20px}
  .card .label{font-size:12px;color:#718096;margin-bottom:4px}
  .card .value{font-size:28px;font-weight:700;color:#63b3ed}
  .card .value.green{color:#68d391}
  .card .value.red{color:#fc8181}
  .card .value.yellow{color:#f6e05e}
  .card .sub{font-size:11px;color:#4a5568;margin-top:2px}
  /* ── Bar chart ── */
  .chart-box{background:#1a1f2e;border:1px solid #2d3748;border-radius:8px;padding:20px;margin-bottom:28px}
  .bars{display:flex;align-items:flex-end;gap:8px;height:140px;padding-top:8px}
  .bar-group{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}
  .bar-wrap{flex:1;width:100%;display:flex;align-items:flex-end}
  .bar{width:100%;background:linear-gradient(180deg,#4299e1,#3182ce);border-radius:4px 4px 0 0;min-height:4px;position:relative;transition:.3s}
  .bar-val{position:absolute;top:-18px;left:0;right:0;text-align:center;font-size:11px;color:#90cdf4}
  .bar-label{font-size:11px;color:#718096;white-space:nowrap}
  .bar-sub{font-size:10px;color:#4a5568;white-space:nowrap}
  /* ── Funnel ── */
  .funnel-box{background:#1a1f2e;border:1px solid #2d3748;border-radius:8px;padding:20px;margin-bottom:28px}
  .funnel-row{display:flex;align-items:center;gap:12px;margin-bottom:8px}
  .funnel-step{font-size:12px;color:#a0aec0;width:130px;flex-shrink:0}
  .funnel-bar-wrap{flex:1;background:#2d3748;border-radius:4px;height:20px;overflow:hidden}
  .funnel-bar{height:100%;background:linear-gradient(90deg,#4299e1,#805ad5);border-radius:4px;transition:.5s}
  .funnel-count{font-size:12px;color:#90cdf4;width:30px;text-align:right;flex-shrink:0}
  /* ── Table ── */
  .table-box{background:#1a1f2e;border:1px solid #2d3748;border-radius:8px;padding:20px;overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:8px 12px;color:#718096;border-bottom:1px solid #2d3748;font-weight:500}
  td{padding:8px 12px;border-bottom:1px solid #1a2035;color:#cbd5e0;vertical-align:top}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#1e2538}
  /* ── Two-col grid ── */
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px}
  @media(max-width:700px){.two-col{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <h1>🤖 ThR Chatbot</h1>
  <span class="badge">Analytics</span>
  <span class="refresh-note">Última atualização: ${new Date().toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</span>
</header>
<main>
  <p class="section-title">Hoje</p>
  <div class="cards">
    <div class="card">
      <div class="label">Sessões</div>
      <div class="value">${today.sessions}</div>
      <div class="sub">conversas iniciadas</div>
    </div>
    <div class="card">
      <div class="label">Mensagens</div>
      <div class="value">${today.messages}</div>
      <div class="sub">recebidas hoje</div>
    </div>
    <div class="card">
      <div class="label">Resolvidos</div>
      <div class="value green">${today.resolved}</div>
      <div class="sub">sem escalar</div>
    </div>
    <div class="card">
      <div class="label">Escalados</div>
      <div class="value ${today.escalations > 0 ? "red" : "green"}">${today.escalations}</div>
      <div class="sub">suporte humano</div>
    </div>
    <div class="card">
      <div class="label">Taxa de resolução</div>
      <div class="value yellow">${resolveRate}%</div>
      <div class="sub">${totalSessions} sessões totais (7d)</div>
    </div>
  </div>

  <p class="section-title">Sessões por dia — últimos 7 dias</p>
  <div class="chart-box">
    <div class="bars">${dayBars}</div>
  </div>

  <div class="two-col">
    <div>
      <p class="section-title">Funil de etapas</p>
      <div class="funnel-box">${funnelRows}</div>
    </div>
    <div>
      <p class="section-title">Mensagens sem resposta adequada (últimas 20)</p>
      <div class="table-box">
        <table>
          <thead><tr><th>Hora</th><th>Sessão</th><th>Mensagem</th></tr></thead>
          <tbody>${clarRows}</tbody>
        </table>
      </div>
    </div>
  </div>
</main>
<script>
  // Auto-refresh every 2 min
  setTimeout(()=>location.reload(), 120_000);
</script>
</body>
</html>`;
}

// ── Login page ────────────────────────────────────────────────────────
function loginHTML(error = false) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ThR Chatbot — Login</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .box{background:#1a1f2e;border:1px solid #2d3748;border-radius:10px;padding:36px 40px;width:320px;text-align:center}
  h2{margin-bottom:24px;font-size:20px}
  input{width:100%;padding:10px 14px;background:#0f1117;border:1px solid #2d3748;border-radius:6px;color:#e2e8f0;font-size:14px;margin-bottom:12px;outline:none}
  input:focus{border-color:#4299e1}
  button{width:100%;padding:10px;background:#3182ce;border:none;border-radius:6px;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
  button:hover{background:#2b6cb0}
  .error{color:#fc8181;font-size:13px;margin-top:8px}
</style>
</head>
<body>
<div class="box">
  <h2>🔐 Analytics ThR</h2>
  <form method="POST" action="/analytics/login">
    <input type="password" name="password" placeholder="Senha" autofocus>
    <button type="submit">Entrar</button>
    ${error ? '<p class="error">Senha incorreta</p>' : ''}
  </form>
</div>
</body>
</html>`;
}

// ── Routes ────────────────────────────────────────────────────────────
router.get("/", (req, res) => {
  if (!isAuthenticated(req)) return res.send(loginHTML());
  const events = readEvents(7);
  const data = processAnalytics(events);
  res.send(buildHTML(data));
});

router.post("/login", (req, res) => {
  const body = req.body || {};
  const submitted = (body.password || "").trim();
  if (submitted === PASSWORD) {
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=${PASSWORD}; Path=/; HttpOnly; Max-Age=${COOKIE_MAX_AGE / 1000}`);
    return res.redirect("/analytics");
  }
  res.send(loginHTML(true));
});

router.get("/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
  res.redirect("/analytics");
});

// ── JSON data API ─────────────────────────────────────────────────────
router.get("/data", (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });
  const events = readEvents(7);
  const data = processAnalytics(events);
  res.json(data);
});

export default router;
