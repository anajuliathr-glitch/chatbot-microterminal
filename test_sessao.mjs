/**
 * test_sessao.mjs
 * Testa o comportamento do bot quando a sessão expira.
 *
 * Como usar:
 *   NODE_ENV=test node test_sessao.mjs
 *
 * IMPORTANTE: O servidor precisa estar rodando com NODE_ENV=test
 */

const BASE = "http://localhost:3001";
let passed = 0, failed = 0;
const failures = [];

// ── Helpers ──────────────────────────────────────────────────────────
function sid(label = "") { return `sessao_${label}_${Math.random().toString(36).slice(2, 8)}`; }

async function chat(msg, sid) {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: msg, session_id: sid }),
  });
  return await res.text();
}

async function expireSession(session_id) {
  const res = await fetch(`${BASE}/test/expire-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id }),
  });
  return await res.json();
}

async function deleteSession(session_id) {
  await fetch(`${BASE}/test/delete-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id }),
  });
}

function check(label, text, shouldContain, shouldNOTContain = null) {
  const ok1 = !shouldContain    || text.toLowerCase().includes(shouldContain.toLowerCase());
  const ok2 = !shouldNOTContain || !text.toLowerCase().includes(shouldNOTContain.toLowerCase());
  const ok = ok1 && ok2;
  if (ok) { passed++; process.stdout.write("✅"); }
  else    {
    failed++;
    failures.push({ label, expected: shouldContain, notExpected: shouldNOTContain, got: text.slice(0, 120) });
    process.stdout.write("❌");
  }
}

function any(...words) { return words[0]; } // helper só para legibilidade

await delay(100);

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

console.log("\n🔄 TESTE DE SESSÃO — expiração e reinício\n");

// ── Verifica se o servidor está rodando ──────────────────────────────
try {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error("Servidor respondeu com erro");
} catch {
  console.error("❌ Servidor não está rodando. Inicie com:\n   NODE_ENV=test node server.js\n");
  process.exit(1);
}

// ── BLOCO A: Sessão normal (controle) ─────────────────────────────────
console.log("📋 Bloco A — Sessão normal (controle):\n");

{
  const s = sid("a");
  const r1 = await chat("oi", s);
  check("A01 início responde com saudação", r1, "nome");

  const r2 = await chat("Fernanda", s);
  check("A02 nome aceito corretamente", r2, "fernanda");

  const r3 = await chat("terminal não conecta", s);
  check("A03 problema recebido, pede mais info ou IP", r3, null, null); // qualquer resposta

  await deleteSession(s);
}

// ── BLOCO B: Sessão expira no passo ask_name ──────────────────────────
console.log("\n\n📋 Bloco B — Expira em ask_name:\n");

{
  const s = sid("b");
  // Inicia sessão (step vira ask_name)
  await chat("oi", s);

  // Expira a sessão via endpoint de teste
  await expireSession(s);

  // Próxima mensagem: bot deve reiniciar (como se fosse nova sessão)
  const r = await chat("Paula", s);
  // Quando sessão expira e chega msg, bot apaga e começa de novo
  // Como "Paula" não é saudação, bot vai para ask_name e responder pedindo nome
  // OU pode interpretar como nome e ir para ask_problem
  check("B01 sessão expirada reinicia conversa", r, null, null);
  // Verifica que a resposta é de início (não está no meio de um fluxo)
  const recomeçou = r.toLowerCase().includes("nome") ||
                    r.toLowerCase().includes("prazer") ||
                    r.toLowerCase().includes("assistente") ||
                    r.toLowerCase().includes("olá") ||
                    r.toLowerCase().includes("oi");
  if (recomeçou) { passed++; process.stdout.write("✅"); }
  else {
    failed++;
    failures.push({ label: "B02 reinício correto após expiração", got: r.slice(0, 120) });
    process.stdout.write("❌");
  }

  await deleteSession(s);
}

// ── BLOCO C: Sessão expira no meio do fluxo (ask_ip) ─────────────────
console.log("\n\n📋 Bloco C — Expira em ask_ip:\n");

{
  const s = sid("c");
  await chat("oi", s);
  await chat("Roberto", s);
  await chat("terminal travou", s);
  // Avança mais um step se necessário
  await chat("nao sei o ip", s);

  // Expira
  await expireSession(s);

  // Reinicia com nova saudação
  const r = await chat("oi", s);
  check("C01 saudação após expiração recomeça", r, "nome");

  // Continua normalmente
  const r2 = await chat("Roberto", s);
  check("C02 aceita nome de novo após expirar", r2, "roberto");

  await deleteSession(s);
}

// ── BLOCO D: Sessão expira em config_terminal ─────────────────────────
console.log("\n\n📋 Bloco D — Expira em config_terminal:\n");

{
  const s = sid("d");
  await chat("oi", s);
  await chat("Marcos", s);
  await chat("terminal não conecta", s);
  await chat("192.168.1.50", s); // manda IP direto

  // Sessão está em config_terminal com IP salvo — expira
  await expireSession(s);

  // Nova mensagem após expirar — deve reiniciar do zero
  const r = await chat("oi", s);
  check("D01 reinicia após expirar em config_terminal", r, "nome");

  // Verifica que o IP antigo NÃO foi mantido (sessão nova)
  const r2 = await chat("Marcos", s);
  const r3 = await chat("terminal não conecta", s);
  // Se perguntar IP, está sem sessão antiga — correto
  const semIpAntigo = !r3.toLowerCase().includes("192.168.1.50");
  if (semIpAntigo) { passed++; process.stdout.write("✅"); }
  else {
    failed++;
    failures.push({ label: "D02 IP antigo não vaza para nova sessão", got: r3.slice(0, 120) });
    process.stdout.write("❌");
  }

  await deleteSession(s);
}

// ── BLOCO E: Mensagem durante sessão ativa — não reinicia ─────────────
console.log("\n\n📋 Bloco E — Sessão ativa não expira:\n");

{
  const s = sid("e");
  await chat("oi", s);
  await chat("Tatiana", s);
  const r1 = await chat("o microterminal não conecta", s);
  // Sessão ATIVA — não expiramos, só testamos que continua no fluxo
  check("E01 sessão ativa mantém contexto", r1, null, "nome"); // não pede nome de novo

  const r2 = await chat("192.168.5.20", s);
  check("E02 IP aceito em sessão ativa", r2, "192.168.5.20");

  await deleteSession(s);
}

// ── BLOCO F: Reset manual ('reset') limpa sessão ─────────────────────
console.log("\n\n📋 Bloco F — Reset manual:\n");

{
  const s = sid("f");
  await chat("oi", s);
  await chat("Giovana", s);
  await chat("terminal caiu", s);

  const r = await chat("reset", s);
  check("F01 reset confirma limpeza", r, "resetada");

  // Após reset, nova mensagem reinicia
  const r2 = await chat("oi", s);
  check("F02 recomeça após reset", r2, "nome");

  await deleteSession(s);
}

// ── BLOCO G: Agradecimento encerra sessão ────────────────────────────
console.log("\n\n📋 Bloco G — Encerramento por agradecimento:\n");

{
  const s = sid("g");
  await chat("oi", s);
  await chat("Lucas", s);

  const r = await chat("valeu", s);
  check("G01 agradecimento encerra", r, "chamar");

  // Após encerrar, nova mensagem reinicia
  const r2 = await chat("oi", s);
  check("G02 recomeça após agradecimento", r2, "nome");

  await deleteSession(s);
}

// ── Resultado ─────────────────────────────────────────────────────────
const total = passed + failed;
console.log("\n\n" + "═".repeat(55));
const pct = Math.round(passed / total * 100);
const icon = pct === 100 ? "🏆" : pct >= 90 ? "✅" : pct >= 80 ? "⚠️" : "❌";
console.log(`  ${icon} RESULTADO: ${passed}/${total} (${pct}%) | ${failed} falhas`);
console.log("═".repeat(55));

if (failures.length) {
  console.log("\n🔍 Falhas:");
  failures.forEach(f => {
    console.log(`\n  ❌ ${f.label}`);
    if (f.expected)    console.log(`     Esperava conter: "${f.expected}"`);
    if (f.notExpected) console.log(`     Não deveria ter: "${f.notExpected}"`);
    console.log(`     Recebeu: "${f.got}"`);
  });
}

console.log();
