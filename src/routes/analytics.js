/**
 * analytics.js — Express router for the ThR chatbot analytics dashboard.
 * Protected by ANALYTICS_PASSWORD env variable (default: "thr2024").
 * Accessible at /analytics
 */
import { Router } from "express";
import fs from "fs";
import path from "path";

const router = Router();
const ANALYTICS_PASSWORD = process.env.ANALYTICS_PASSWORD || "thr2024";

// ── Simple cookie parser (inline, no dependency) ──────────────────────
function parseCookies(req) {
  const list = {};
  const header = req.headers.cookie;
  if (!header) return list;
  for (const part of header.split(";")) {
    const [k, ...v] = part.split("=");
    list[k.trim()] = decodeURIComponent(v.join("=").trim());
  }
  return list;
}

// ── Simple password protection via query param or cookie ─────────────
router.use((req, res, next) => {
  const cookies = parseCookies(req);
  const pwd = req.query.pwd || cookies.analytics_pwd;
  if (pwd === ANALYTICS_PASSWORD) {
    res.setHeader("Set-Cookie", `analytics_pwd=${encodeURIComponent(pwd)}; Max-Age=86400; HttpOnly; Path=/analytics`);
    return next();
  }
  if (req.method === "POST" && req.body?.pwd === ANALYTICS_PASSWORD) {
    res.setHeader("Set-Cookie", `analytics_pwd=${encodeURIComponent(req.body.pwd)}; Max-Age=86400; HttpOnly; Path=/analytics`);
    return res.redirect("/analytics");
  }
  return res.send(LOGIN_HTML);
});

router.get("/", (req, res) => {
  const data = loadAnalytics(7);
  res.send(buildDashboardHTML(data));
});

export default router;

// ── Data loading ──────────────────────────────────────────────────────

function loadAnalytics(days) {
  const events = [];
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().slice(0, 10);
    const filePath = path.join("./logs", `analytics-${dateStr}.jsonl`);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch {}
    }
  }
  return processAnalytics(events);
}

function processAnalytics(events) {
  const byDay = {};
  const sessionSteps = {};
  const clarifications = [];
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const e of events) {
    const day = e.ts?.slice(0, 10) || "unknown";
    if (!byDay[day]) {
      byDay[day] = { messages: 0, sessions: new Set(), resolved: 0, escalations: 0 };
    }

    if (e.type === "message") {
      byDay[day].messages++;
    }
    if (e.type === "session_start") {
      byDay[day].sessions.add(e.from);
    }
    if (e.type === "resolved") {
      byDay[day].resolved++;
    }
    if (e.type === "escalation") {
      byDay[day].escalations++;
    }
    if (e.type === "clarification") {
      clarifications.push(e);
    }
    if (e.type === "step_change" && e.to_step) {
      const cur = sessionSteps[e.from];
      if (!cur || stepOrder(e.to_step) > stepOrder(cur)) {
        sessionSteps[e.from] = e.to_step;
      }
    }
  }

  // Funnel: count how many sessions reached each step
  const stepCounts = {};
  for (const step of Object.values(sessionSteps)) {
    stepCounts[step] = (stepCounts[step] || 0) + 1;
  }

  const todayData = byDay[todayStr] || { messages: 0, sessions: new Set(), resolved: 0, escalations: 0 };

  // Find step where most users get stuck (most clarifications)
  const stepStuck = {};
  for (const c of clarifications) {
    stepStuck[c.step] = (stepStuck[c.step] || 0) + 1;
  }
  const mostStuckStep = Object.entries(stepStuck).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const totalResolved = Object.values(byDay).reduce((s, d) => s + d.resolved, 0);
  const totalEscalations = Object.values(byDay).reduce((s, d) => s + d.escalations, 0);
  const totalSessions = Object.values(byDay).reduce((s, d) => s + d.sessions.size, 0);

  return {
    today: {
      messages: todayData.messages,
      sessions: todayData.sessions.size,
      resolved: todayData.resolved,
      escalations: todayData.escalations,
    },
    byDay: Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        messages: d.messages,
        sessions: d.sessions.size,
        resolved: d.resolved,
        escalations: d.escalations,
      })),
    funnel: stepCounts,
    clarifications: clarifications.slice(-20).reverse(),
    totalResolved,
    totalEscalations,
    totalSessions,
    mostStuckStep,
    resolutionRate: totalSessions > 0 ? Math.round((totalResolved / totalSessions) * 100) : 0,
    escalationRate: totalSessions > 0 ? Math.round((totalEscalations / totalSessions) * 100) : 0,
  };
}

function stepOrder(step) {
  return ["start", "ask_name", "ask_name_then_problem", "ask_problem", "rag_followup", "ask_ip", "teach_ip", "config_terminal", "escalation", "confirm_done", "final"].indexOf(step);
}

// ── HTML generation ───────────────────────────────────────────────────

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ThR Analytics — Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f4f8; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.10); padding: 40px 48px; width: 360px; }
    .logo { font-size: 28px; font-weight: 700; color: #0066cc; margin-bottom: 8px; }
    .subtitle { color: #6b7280; font-size: 14px; margin-bottom: 32px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; }
    input[type=password] { width: 100%; padding: 10px 14px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 15px; outline: none; transition: border-color 0.2s; }
    input[type=password]:focus { border-color: #0066cc; }
    button { width: 100%; margin-top: 20px; padding: 11px; background: #0066cc; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #0052a3; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">ThR Analytics</div>
    <div class="subtitle">Dashboard de atendimento do chatbot</div>
    <form method="POST" action="/analytics">
      <label>Senha de acesso</label>
      <input type="password" name="pwd" autofocus placeholder="••••••••">
      <button type="submit">Entrar</button>
    </form>
  </div>
</body>
</html>`;

function buildDashboardHTML(data) {
  const { today, byDay, funnel, clarifications, totalResolved, totalEscalations, totalSessions, mostStuckStep, resolutionRate, escalationRate } = data;

  // Bar chart: sessions per day
  const maxSessions = Math.max(...byDay.map(d => d.sessions), 1);
  const barChart = byDay.length === 0
    ? `<p class="empty">Nenhum dado ainda</p>`
    : byDay.map(d => {
        const pct = Math.round((d.sessions / maxSessions) * 100);
        const label = d.date.slice(5); // MM-DD
        return `
          <div class="bar-group">
            <div class="bar-wrap">
              <div class="bar" style="height:${pct}%" title="${d.sessions} sessões"></div>
            </div>
            <div class="bar-label">${label}</div>
            <div class="bar-value">${d.sessions}</div>
          </div>`;
      }).join("");

  // Funnel steps
  const FUNNEL_STEPS = [
    { key: "ask_problem", label: "Descreveu problema" },
    { key: "ask_ip", label: "Pediu IP" },
    { key: "teach_ip", label: "Ensinou IP" },
    { key: "config_terminal", label: "Configuração" },
    { key: "escalation", label: "Escalação" },
    { key: "confirm_done", label: "Confirmação" },
  ];
  const maxFunnel = Math.max(...FUNNEL_STEPS.map(s => funnel[s.key] || 0), 1);
  const funnelRows = FUNNEL_STEPS.map(s => {
    const count = funnel[s.key] || 0;
    const pct = Math.round((count / maxFunnel) * 100);
    return `
      <div class="funnel-row">
        <div class="funnel-label">${s.label}</div>
        <div class="funnel-bar-wrap">
          <div class="funnel-bar" style="width:${pct}%"></div>
        </div>
        <div class="funnel-count">${count}</div>
      </div>`;
  }).join("");

  // Clarifications table
  const clarRows = clarifications.length === 0
    ? `<tr><td colspan="3" class="empty-cell">Nenhum dado ainda</td></tr>`
    : clarifications.map(c => {
        const ts = c.ts ? new Date(c.ts).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-";
        const msg = (c.msg || "").slice(0, 80);
        return `<tr><td>${ts}</td><td><span class="badge">${c.step || "-"}</span></td><td>${escHtml(msg)}</td></tr>`;
      }).join("");

  const stuckLabel = mostStuckStep ? `<span class="badge">${mostStuckStep}</span>` : `<span class="muted">—</span>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ThR Analytics Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f4f8; color: #1f2937; }

    /* Layout */
    .sidebar { position: fixed; top: 0; left: 0; width: 220px; height: 100vh; background: #0f172a; color: #e2e8f0; padding: 32px 20px; display: flex; flex-direction: column; }
    .sidebar .logo { font-size: 20px; font-weight: 700; color: #60a5fa; margin-bottom: 4px; }
    .sidebar .tagline { font-size: 12px; color: #64748b; margin-bottom: 40px; }
    .sidebar nav a { display: block; padding: 10px 14px; border-radius: 8px; color: #94a3b8; font-size: 14px; text-decoration: none; margin-bottom: 4px; }
    .sidebar nav a.active, .sidebar nav a:hover { background: #1e293b; color: #e2e8f0; }
    .sidebar .refresh { margin-top: auto; font-size: 12px; color: #475569; }
    .sidebar .refresh a { color: #60a5fa; text-decoration: none; }

    .main { margin-left: 220px; padding: 32px; min-height: 100vh; }

    /* Header */
    h1 { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
    .header-sub { font-size: 13px; color: #6b7280; margin-bottom: 28px; }

    /* Stat cards */
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
    .card { background: #fff; border-radius: 12px; padding: 20px 24px; box-shadow: 0 1px 6px rgba(0,0,0,0.07); }
    .card .label { font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
    .card .value { font-size: 32px; font-weight: 700; color: #0f172a; line-height: 1; }
    .card .sub { font-size: 12px; color: #9ca3af; margin-top: 6px; }
    .card.blue .value { color: #0066cc; }
    .card.green .value { color: #16a34a; }
    .card.red .value { color: #dc2626; }
    .card.orange .value { color: #d97706; }

    /* Sections */
    .section { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 6px rgba(0,0,0,0.07); margin-bottom: 24px; }
    .section h2 { font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 20px; }

    /* Bar chart */
    .bar-chart { display: flex; align-items: flex-end; gap: 12px; height: 160px; padding-bottom: 28px; position: relative; }
    .bar-group { display: flex; flex-direction: column; align-items: center; flex: 1; height: 100%; justify-content: flex-end; }
    .bar-wrap { flex: 1; display: flex; align-items: flex-end; width: 100%; justify-content: center; }
    .bar { width: 28px; background: #0066cc; border-radius: 4px 4px 0 0; min-height: 4px; transition: height 0.3s; }
    .bar-label { font-size: 11px; color: #6b7280; margin-top: 6px; }
    .bar-value { font-size: 11px; font-weight: 600; color: #374151; }

    /* Funnel */
    .funnel-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .funnel-label { width: 160px; font-size: 13px; color: #374151; flex-shrink: 0; }
    .funnel-bar-wrap { flex: 1; background: #f1f5f9; border-radius: 6px; height: 20px; overflow: hidden; }
    .funnel-bar { height: 100%; background: linear-gradient(90deg, #0066cc, #38bdf8); border-radius: 6px; min-width: 4px; }
    .funnel-count { width: 32px; text-align: right; font-size: 13px; font-weight: 600; color: #0f172a; }

    /* Table */
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #f1f5f9; }
    td { padding: 10px 12px; border-bottom: 1px solid #f8fafc; color: #374151; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f8fafc; }
    .empty-cell { text-align: center; color: #9ca3af; padding: 24px; }

    /* Stats row */
    .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .stat-item { text-align: center; }
    .stat-item .stat-val { font-size: 28px; font-weight: 700; color: #0066cc; }
    .stat-item .stat-label { font-size: 12px; color: #6b7280; margin-top: 4px; }

    /* Misc */
    .badge { display: inline-block; padding: 2px 8px; background: #eff6ff; color: #1d4ed8; border-radius: 99px; font-size: 11px; font-weight: 600; }
    .muted { color: #9ca3af; }
    .empty { color: #9ca3af; text-align: center; padding: 24px 0; font-size: 14px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

    @media (max-width: 900px) {
      .sidebar { display: none; }
      .main { margin-left: 0; padding: 16px; }
      .cards { grid-template-columns: repeat(2, 1fr); }
      .two-col { grid-template-columns: 1fr; }
      .stats-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="logo">ThR Analytics</div>
    <div class="tagline">Chatbot Microterminal</div>
    <nav>
      <a href="/analytics" class="active">Dashboard</a>
    </nav>
    <div class="refresh">
      Atualizado agora<br>
      <a href="/analytics">Atualizar</a>
    </div>
  </div>

  <div class="main">
    <h1>Dashboard de Atendimento</h1>
    <p class="header-sub">Últimos 7 dias · Fuso: Brasília</p>

    <!-- Stat Cards: Today -->
    <div class="cards">
      <div class="card blue">
        <div class="label">Sessões hoje</div>
        <div class="value">${today.sessions}</div>
        <div class="sub">conversas iniciadas</div>
      </div>
      <div class="card">
        <div class="label">Mensagens hoje</div>
        <div class="value">${today.messages}</div>
        <div class="sub">total de mensagens</div>
      </div>
      <div class="card green">
        <div class="label">Resolvidos hoje</div>
        <div class="value">${today.resolved}</div>
        <div class="sub">confirmados pelo usuário</div>
      </div>
      <div class="card red">
        <div class="label">Escalações hoje</div>
        <div class="value">${today.escalations}</div>
        <div class="sub">suporte humano solicitado</div>
      </div>
    </div>

    <div class="two-col">
      <!-- Bar chart: sessions per day -->
      <div class="section">
        <h2>Sessões por dia (últimos 7 dias)</h2>
        <div class="bar-chart">
          ${barChart}
        </div>
      </div>

      <!-- Overall stats -->
      <div class="section">
        <h2>Indicadores gerais (7 dias)</h2>
        <div class="stats-row" style="margin-top:8px;">
          <div class="stat-item">
            <div class="stat-val">${resolutionRate}%</div>
            <div class="stat-label">Taxa de resolução</div>
          </div>
          <div class="stat-item">
            <div class="stat-val">${escalationRate}%</div>
            <div class="stat-label">Taxa de escalação</div>
          </div>
          <div class="stat-item">
            <div class="stat-val">${totalSessions}</div>
            <div class="stat-label">Total de sessões</div>
          </div>
        </div>
        <div style="margin-top:28px; padding-top:20px; border-top:1px solid #f1f5f9;">
          <div style="font-size:12px; color:#6b7280; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">Step com mais travamentos</div>
          <div style="font-size:20px;">${stuckLabel}</div>
        </div>
      </div>
    </div>

    <!-- Funnel -->
    <div class="section">
      <h2>Funil de conversas — até onde chegaram (7 dias)</h2>
      ${funnel && Object.keys(funnel).length > 0 ? funnelRows : `<p class="empty">Nenhum dado ainda</p>`}
    </div>

    <!-- Clarifications table -->
    <div class="section">
      <h2>Últimas mensagens não entendidas (clarificações)</h2>
      ${clarifications.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Horário</th>
            <th>Step</th>
            <th>Mensagem</th>
          </tr>
        </thead>
        <tbody>
          ${clarRows}
        </tbody>
      </table>` : `<p class="empty">Nenhum dado ainda</p>`}
    </div>
  </div>
</body>
</html>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
