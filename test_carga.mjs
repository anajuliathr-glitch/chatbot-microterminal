/**
 * test_carga.mjs
 * Simula N usuários simultâneos conversando com o bot.
 * Mede tempo de resposta, taxa de sucesso e estabilidade.
 *
 * Como usar:
 *   node test_carga.mjs          (padrão: 50 usuários)
 *   node test_carga.mjs 20       (20 usuários)
 *   node test_carga.mjs 100      (100 usuários — stress test)
 */

const BASE       = "http://localhost:3001/chat";
const N_USUARIOS = parseInt(process.argv[2] || "50", 10);

const tempos   = [];
let erros      = 0;
let sucesso    = 0;
let timeouts   = 0;

function sid(i) { return `carga_u${i}_${Date.now()}`; }

async function chat(msg, session_id, timeoutMs = 8000) {
  const inicio = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, session_id }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    const ms = Date.now() - inicio;
    tempos.push(ms);
    if (text.trim().length > 0) sucesso++;
    else erros++;
    return { ok: true, text, ms };
  } catch (e) {
    clearTimeout(timer);
    const ms = Date.now() - inicio;
    if (e.name === "AbortError") {
      timeouts++;
      console.log(`  ⏱️  Timeout após ${ms}ms`);
    } else {
      erros++;
    }
    return { ok: false, text: "", ms };
  }
}

// ── Conversa completa de um usuário ─────────────────────────────────
// Fluxo: oi → nome → problema → ip → resolveu → tchau
async function conversaCompleta(i) {
  const s = sid(i);
  const nome = `User${i}`;
  const ip   = `192.168.${Math.floor(i / 255)}.${i % 255 || 1}`;

  await chat("oi", s);
  await chat(nome, s);
  await chat("terminal nao conecta", s);
  await chat(ip, s);
  const r = await chat("deu certo", s);
  await chat("valeu", s);
  return r.ok;
}

// ── Conversa curta (só o problema, sem resolver) ─────────────────────
async function conversaCurta(i) {
  const s = sid(i) + "_curta";
  await chat("oi", s);
  await chat(`Teste${i}`, s);
  const r = await chat("mictroterminal travou", s);
  return r.ok;
}

// ── Conversa de desistência ──────────────────────────────────────────
async function conversaDesistencia(i) {
  const s = sid(i) + "_desist";
  await chat("oi", s);
  await chat(`Des${i}`, s);
  await chat("terminal caiu", s);
  await chat("nao sei o ip", s);
  const r = await chat("nao quero mais", s);
  return r.ok;
}

// ── Executa o teste de carga ─────────────────────────────────────────
console.log(`\n⚡ TESTE DE CARGA — ${N_USUARIOS} usuários simultâneos\n`);
console.log("Tipos de conversa:");
console.log("  🟢 Completa (6 msgs): 50% dos usuários");
console.log("  🟡 Curta (3 msgs):    30% dos usuários");
console.log("  🔴 Desistência (5 msgs): 20% dos usuários");
console.log("\nIniciando...\n");

const inicio = Date.now();

// Divide os usuários em 3 grupos
const promises = [];
for (let i = 1; i <= N_USUARIOS; i++) {
  const tipo = i % 10;
  if (tipo <= 5)      promises.push(conversaCompleta(i));    // 50%
  else if (tipo <= 8) promises.push(conversaCurta(i));        // 30%
  else                promises.push(conversaDesistencia(i));  // 20%
}

// Lança todos simultaneamente e aguarda
const resultados = await Promise.allSettled(promises);
const totalMs    = Date.now() - inicio;

// ── Analisa resultados ───────────────────────────────────────────────
const okCount    = resultados.filter(r => r.status === "fulfilled" && r.value).length;
const failCount  = resultados.filter(r => r.status === "rejected"  || !r.value).length;

// Estatísticas de tempo
const temposOrdenados = [...tempos].sort((a, b) => a - b);
const media    = tempos.length ? Math.round(tempos.reduce((s, v) => s + v, 0) / tempos.length) : 0;
const mediana  = tempos.length ? temposOrdenados[Math.floor(tempos.length / 2)] : 0;
const p95      = tempos.length ? temposOrdenados[Math.floor(tempos.length * 0.95)] : 0;
const maximo   = tempos.length ? Math.max(...tempos) : 0;
const minimo   = tempos.length ? Math.min(...tempos) : 0;

// ── Relatório ────────────────────────────────────────────────────────
console.log("═".repeat(55));
console.log("  RESULTADO DO TESTE DE CARGA");
console.log("═".repeat(55));
console.log(`\n  👥 Usuários simultâneos: ${N_USUARIOS}`);
console.log(`  ⏱️  Duração total:         ${(totalMs / 1000).toFixed(1)}s`);
console.log(`  📨 Mensagens enviadas:    ${tempos.length + timeouts}`);
console.log(`  ✅ Conversas OK:          ${okCount}/${N_USUARIOS}`);
console.log(`  ❌ Conversas com falha:   ${failCount}`);
console.log(`  ⏱️  Timeouts:              ${timeouts}`);

console.log(`\n  📊 TEMPOS DE RESPOSTA:`);
console.log(`     Mínimo:  ${minimo}ms`);
console.log(`     Médio:   ${media}ms`);
console.log(`     Mediana: ${mediana}ms`);
console.log(`     P95:     ${p95}ms  ← 95% das respostas abaixo disso`);
console.log(`     Máximo:  ${maximo}ms`);

// Avaliação
console.log(`\n  🏆 AVALIAÇÃO:`);
const taxaSucesso = Math.round(okCount / N_USUARIOS * 100);
if (taxaSucesso === 100 && media < 1000) {
  console.log(`     ✅ EXCELENTE — ${taxaSucesso}% sucesso, média ${media}ms`);
} else if (taxaSucesso >= 95 && media < 2000) {
  console.log(`     ✅ BOM — ${taxaSucesso}% sucesso, média ${media}ms`);
} else if (taxaSucesso >= 80) {
  console.log(`     ⚠️  ACEITÁVEL — ${taxaSucesso}% sucesso, média ${media}ms`);
} else {
  console.log(`     ❌ PROBLEMA — só ${taxaSucesso}% sucesso`);
}

if (p95 < 500)       console.log("     ⚡ Velocidade: RÁPIDO (P95 < 500ms)");
else if (p95 < 1500) console.log("     🟡 Velocidade: NORMAL (P95 < 1500ms)");
else if (p95 < 3000) console.log("     🟠 Velocidade: LENTO (P95 < 3s)");
else                 console.log("     🔴 Velocidade: MUITO LENTO (P95 > 3s)");

if (timeouts > 0)    console.log(`     ⚠️  Atenção: ${timeouts} timeout(s) — servidor pode estar sobrecarregado`);

console.log("\n" + "═".repeat(55));
