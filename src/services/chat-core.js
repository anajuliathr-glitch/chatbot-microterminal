/**
 * chat-core.js — Shared conversation logic for the ThR microterminal chatbot.
 * Used by both src/routes/chat.js (HTTP/API) and src/services/whatsapp-message.js (WhatsApp).
 */
import stringSimilarity from "string-similarity";
import { logEvent } from "./analytics.js";

// ────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────

/** Sorteia resposta aleatória (bot mais humano) */
export function pick(...opts) {
  return opts[Math.floor(Math.random() * opts.length)];
}

/** Saudação adequada ao horário de Brasília, com suporte a DATE_OVERRIDE */
export function saudacaoHorario() {
  const base = process.env.DATE_OVERRIDE ? new Date(process.env.DATE_OVERRIDE) : new Date();
  const now = new Date(base.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const h = now.getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

/** Verifica se está no horário de atendimento (seg-sex 8h-18h, fuso Brasília) */
export function isBusinessHours() {
  const base = process.env.DATE_OVERRIDE ? new Date(process.env.DATE_OVERRIDE) : new Date();
  const now = new Date(base.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const day = now.getDay();   // 0=Dom, 1=Seg ... 5=Sex, 6=Sáb
  const hour = now.getHours();
  return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
}

export const MSG_FORA_HORARIO =
  `Olá! Você está fora do horário de atendimento (seg-sex 8h-18h) 🫤\n\n` +
  `Mas não tem problema, sou um BOT de atendimento e posso te ajudar com dúvidas e problemas pontuais sobre o microterminal. ` +
  `Caso não consigamos resolver hoje, vou registrar seu caso e um técnico entra em contato assim que estivermos ON de novo 😁👍\n\n`;

// ────────────────────────────────────────────────────────────────────
// Normalization
// ────────────────────────────────────────────────────────────────────

/** Normaliza a mensagem: lowercase, sem acentos + typos comuns (versão completa) */
export function normalizar(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim()

    // ── pontuação que atrapalha o matching ───────────────────────
    .replace(/[.!?]+$/, "")          // remove pontuação no final ("Nada." → "Nada")
    .replace(/\.\.\./g, " ")         // reticências → espaço

    // ── abreviações e gírias ──────────────────────────────────────
    .replace(/\bnaum\b/g, "nao")
    .replace(/\bnaon\b/g, "nao")
    .replace(/\bnaoo\b/g, "nao")
    .replace(/\bvc\b/g, "voce")
    .replace(/\bvcs\b/g, "voces")
    .replace(/\boq\b/g, "o que")
    .replace(/\boquê\b/g, "o que")
    .replace(/\bpq\b/g, "porque")
    .replace(/\bpqp\b/g, "")
    .replace(/\bmt\b/g, "muito")
    .replace(/\bmto\b/g, "muito")
    .replace(/\btb\b/g, "tambem")
    .replace(/\btbm\b/g, "tambem")
    .replace(/\bmsm\b/g, "mesmo")
    .replace(/\baki\b/g, "aqui")
    .replace(/\bnop+\b/g, "nao")
    .replace(/\bneh\b/g, "nao")
    .replace(/\bblz\b/g, "beleza")
    .replace(/\bflw\b/g, "falou")
    .replace(/\bvlw\b/g, "valeu")
    .replace(/\bobg\b/g, "obrigado")
    .replace(/\bkd\b/g, "cadê")
    .replace(/\bfds\b/g, "fim de semana")
    .replace(/\btá\b/g, "ta")
    .replace(/\bto\b/g, "estou")
    .replace(/\btô\b/g, "estou")
    .replace(/\bokk+\b/g, "ok")

    // ── typos de "não" ────────────────────────────────────────────
    .replace(/\bn[aã]o\b/g, "nao")
    .replace(/\bnao\b/g, "nao")
    .replace(/\bna[09]\b/g, "nao")      // Na9, Na0 → não
    .replace(/\bn4o\b/g, "nao")         // n4o → não

    // ── typos de "sim" ────────────────────────────────────────────
    .replace(/\bso+m\b/g, "sim")
    .replace(/\bsi+m+\b/g, "sim")
    .replace(/\bsi\b/g, "sim")
    .replace(/\bsium\b/g, "sim")
    .replace(/\bxim\b/g, "sim")

    // ── "foi" com letras repetidas ────────────────────────────────
    .replace(/\bfo+i+\b/g, "foi")    // foii, foiii, foiiii → foi

    // ── "deu" com letras repetidas ────────────────────────────────
    .replace(/\bde+u+\b/g, "deu")    // deuuu, deuuu → deu

    // ── typos de "ainda" ─────────────────────────────────────────
    .replace(/\baind[sa]?\b/g, "ainda")

    // ── typos de "conectar/conexão" ──────────────────────────────
    .replace(/\bconef[a-z]+\b/g, "nao conecta")   // conefay, conefou etc
    .replace(/\bcob[ae]t[a-z]*\b/g, "conecta")    // cobeta, cobeta → conecta
    .replace(/\bco[a-z]?et[a-z]*\b/g, "conecta")  // coeta, coreta → conecta
    .replace(/\bconeta[a-z]*\b/g, "conecta")
    .replace(/\bkoneta[a-z]*\b/g, "conecta")
    .replace(/\bkonect[a-z]*\b/g, "conecta")
    .replace(/\bconect[ao]u\b/g, "conectou")
    .replace(/\bconetou\b/g, "conectou")
    .replace(/\bconectô\b/g, "conectou")
    .replace(/\bconexaum\b/g, "conexao")
    .replace(/\bkonexao\b/g, "conexao")
    .replace(/\bconetar\b/g, "conectar")
    .replace(/\bdesconet[a-z]+\b/g, "desconectou")    // desconetou
    .replace(/\bdesconert[a-z]+\b/g, "desconectou")   // desconertou
    .replace(/\bdesconect[a-z]+\b/g, "desconectou")   // desconectou (correto e variações)
    .replace(/\bdisconect[a-z]+\b/g, "desconectou")   // disconectou
    .replace(/\bdesconetc[a-z]+\b/g, "desconectou")   // desconetcou
    .replace(/\bdesconec[^t][a-z]*\b/g, "desconectou") // desconecou, desconecou etc

    // ── typos de "funcionar" ──────────────────────────────────────
    .replace(/\bfuncion[ao]u\b/g, "funcionou")
    .replace(/\bfuncionô\b/g, "funcionou")
    .replace(/\bfuncion[ao]\b/g, "funciona")
    .replace(/\bfuncioa\b/g, "funciona")
    .replace(/\bfuncionay\b/g, "funciona")
    .replace(/\bfunçiona\b/g, "funciona")
    .replace(/\bfunco\b/g, "funciona")

    // ── typos de "microterminal" ──────────────────────────────────
    .replace(/\bmicro\s+terminal\b/g, "microterminal")
    .replace(/\bmicroterminau\b/g, "microterminal")
    .replace(/\bmictroterminal\b/g, "microterminal")
    .replace(/\bmircoterminal\b/g, "microterminal")
    .replace(/\bmicrotermianl\b/g, "microterminal")
    .replace(/\bmicrotermial\b/g, "microterminal")
    .replace(/\bmicrotermina[l1]\b/g, "microterminal")
    .replace(/\bmicroterinal\b/g, "microterminal")
    .replace(/\bmicrotermino\b/g, "microterminal")
    .replace(/\bm[iíì]croterminal\b/g, "microterminal")
    .replace(/\bmicro\b/g, "microterminal")

    // ── terminações "au" no lugar de "ou"/"al" ────────────────────
    .replace(/\bterminau\b/g, "terminal")
    .replace(/\bfuncionau\b/g, "funcionou")
    .replace(/\bconectau\b/g, "conectou")
    .replace(/\bdesligau\b/g, "desligou")
    .replace(/\bligau\b/g, "ligou")
    .replace(/\bsalvau\b/g, "salvou")
    .replace(/\btravau\b/g, "travou")
    .replace(/\berradu\b/g, "errado")
    .replace(/\btadu\b/g, "tado")
    .replace(/\bapareceu\b/g, "apareceu")

    // ── typos de "problema" ───────────────────────────────────────
    .replace(/\bpoblema\b/g, "problema")
    .replace(/\bporblema\b/g, "problema")
    .replace(/\bproblemon\b/g, "problema")
    .replace(/\bprobrlema\b/g, "problema")
    .replace(/\bprobema\b/g, "problema")
    .replace(/\bploblema\b/g, "problema")
    .replace(/\bproblemao\b/g, "problema")

    // ── typos de "não aparece / não acha" ────────────────────────
    .replace(/\bnapareceu\b/g, "nao apareceu")
    .replace(/\bnaparece\b/g, "nao aparece")

    // ── typos de "configurar/pressionar" ─────────────────────────
    .replace(/\bcofigurar\b/g, "configurar")
    .replace(/\bconfigurau\b/g, "configurou")
    .replace(/\bconfigurô\b/g, "configurou")
    .replace(/\bconfigurou\b/g, "configurou")
    .replace(/\bprecionar\b/g, "pressionar")
    .replace(/\bprecionei\b/g, "pressionei")
    .replace(/\bpressionau\b/g, "pressionou")
    .replace(/\bpresionei\b/g, "pressionei")

    // ── typos de "salvar" ─────────────────────────────────────────
    .replace(/\bsarvei\b/g, "salvei")
    .replace(/\bsarvou\b/g, "salvou")

    // ── typos de "ligar/desligar" ─────────────────────────────────
    .replace(/\bdesliga\b/g, "desligue")
    .replace(/\bdesligô\b/g, "desligou")
    .replace(/\bligô\b/g, "ligou")

    // ── typos de "teclado" ────────────────────────────────────────
    .replace(/\btecladu\b/g, "teclado")
    .replace(/\btecaldo\b/g, "teclado")
    .replace(/\btecado\b/g, "teclado")

    // ── typos de "cabo" ───────────────────────────────────────────
    .replace(/\bcabu\b/g, "cabo")
    .replace(/\bcab[oô]\b/g, "cabo")

    // ── typos de "achei/encontrei" ────────────────────────────────
    .replace(/\bachei\b/g, "achei")
    .replace(/\bachô\b/g, "achou")
    .replace(/\bencontrei\b/g, "encontrei")
    .replace(/\bencontrô\b/g, "encontrou");
}

// ────────────────────────────────────────────────────────────────────
// Fuzzy normalizer
// ────────────────────────────────────────────────────────────────────

const FUZZY_KEYWORDS = {
  "desconectou":  ["desconectou","desconetou","desconertou","disconectou","desconecou","desconnectou"],
  "conectou":     ["conectou","conetou","conecou","connectou","conctou"],
  "conecta":      ["conecta","coneta","konecta","conekta"],
  "conectar":     ["conectar","conetar","connectar","konectar"],
  "funciona":     ["funciona","funçiona","funcioa","funco","funcionya","funciorna"],
  "funcionou":    ["funcionou","funcionô","funcionau","funconou","funcionow"],
  "carregando":   ["carregando","caregando","carreganod","carregondo","carregand"],
  "carrega":      ["carrega","carega","caarega","carrega"],
  "configurar":   ["configurar","cofigurar","configurrar","configuarar","confiugar"],
  "configurou":   ["configurou","cofigurou","configurô","configurau"],
  "pressionar":   ["pressionar","precionar","pressionnar","presionar","pressioar"],
  "pressionei":   ["pressionei","precionei","presionei","pressoinei"],
  "desligar":     ["desligar","dezligar","desliguar","deslgar"],
  "desligou":     ["desligou","dezligou","desligô","desligau"],
  "microterminal":["microterminal","mircoterminal","microterinal","microtermianl","mictroterminal"],
  "teclado":      ["teclado","tecladu","tecaldo","tecado","tecldo"],
  "problema":     ["problema","poblema","porblema","probema","ploblema","probrlema"],
  "encontrei":    ["encontrei","encontri","encontrei","encotrei","enontrei"],
  "apareceu":     ["apareceu","apareceo","aoareceu","aparceu","aparceeu"],
};

const _fuzzyTerms = Object.keys(FUZZY_KEYWORDS);

function fuzzyNormalizarPalavra(palavra) {
  if (palavra.length < 6) return palavra;
  const best = stringSimilarity.findBestMatch(palavra, _fuzzyTerms);
  if (best.bestMatch.rating >= 0.80) return best.bestMatch.target;
  return palavra;
}

export function fuzzyNormalizar(msg) {
  return msg.split(/\b/).map(token => {
    if (!/^[a-z]{6,}$/.test(token)) return token;
    return fuzzyNormalizarPalavra(token);
  }).join("");
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/** Verifica se a mensagem contém pelo menos uma das palavras/frases */
export function contemAlgum(msg, lista) {
  return lista.some(w => msg.includes(w));
}

/** Extrai o primeiro IP válido da mensagem */
export function extrairIP(msg) {
  const match = msg.match(/\b((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/);
  return match ? match[0] : null;
}

/** Filtra IPs especiais que não servem para configurar o microterminal */
export function isValidConfigIP(ip) {
  if (!ip) return false;
  const parts = ip.split(".").map(Number);
  if (parts[0] === 127) return false;                     // loopback (127.x.x.x)
  if (parts[0] === 169 && parts[1] === 254) return false; // APIPA (169.254.x.x)
  if (ip === "0.0.0.0") return false;
  if (ip === "255.255.255.255") return false;
  return true;
}

export function buildAskIpMsg(name) {
  const n = name ? `${name}, você` : "Você";
  return `${n} sabe o IP do computador? 😊\n\nSe souber, me manda direto.\nSe não souber, é só falar *"não sei"* que te ensino a encontrar 👍`;
}

export function instrucaoIP() {
  return `Sem problema! Vamos buscar o IP 👇\n\n1️⃣ Pressione a tecla *Windows*\n2️⃣ Digite *cmd* e abra\n3️⃣ Digite *ipconfig* e pressione Enter\n4️⃣ Procure por *Endereço IPv4*\n\nO número fica assim: *192.168.x.x*\n\nMe manda quando encontrar 😊`;
}

export function buildConfigMsg(ip, soPassos = false) {
  if (!ip) return `Ops, não tenho o IP anotado 😕\n\nPode me mandar o IP do computador?`;
  const intro = soPassos ? "" : `Anotei o IP: *${ip}* 👍\n\n`;
  return (
    `${intro}Agora vamos configurar o microterminal:\n\n` +
    `1️⃣ Certifique-se que o *teclado está conectado* no microterminal\n` +
    `2️⃣ *Desligue* o microterminal e *ligue* novamente\n` +
    `3️⃣ Assim que aparecerem os *pontinhos na tela*, pressione a tecla *P*\n` +
    `   _(deixe o dedo já posicionado no P antes de ligar)_\n` +
    `4️⃣ No menu que aparecer, pressione *1* (IP do servidor)\n` +
    `5️⃣ Digite o IP: *${ip}*\n` +
    `6️⃣ Pressione *Enter*\n` +
    `7️⃣ Pressione *H*\n` +
    `8️⃣ Pressione *1* para salvar e sair\n\n` +
    `Aguarde — o terminal vai conectar automaticamente 😊\n\nMe avisa como foi!`
  );
}

// ────────────────────────────────────────────────────────────────────
// Intent detection (sync)
// ────────────────────────────────────────────────────────────────────

/**
 * Retorna true APENAS se a mensagem é claramente positiva/afirmativa.
 * Verifica se existe negação ANTES da palavra positiva na frase.
 */
export function isPositive(msg) {
  if (isNegative(msg)) return false;
  if (/\bnenhum[ao]?\b|\bnada\b/.test(msg)) return false;
  // Sinais claros de problema — nunca são positivos
  if (msg.includes("tela preta") || msg.includes("tela apagada") ||
      msg.includes("nao conectou") || msg.includes("não conectou") ||
      msg.includes("nao funciona") || msg.includes("nao conecta")) return false;

  const exatos = ["sim","simm","ss","s","aham","uhum","fiz"];
  if (exatos.some(w => msg.trim() === w)) return true;
  if (["foi","deu","conectou","funcionou","resolveu"].includes(msg.trim())) return true;
  // "foi" / "deu" ao final: "aahh foi", "nossa foi", "finalmente deu" etc.
  if (/\bfoi$/.test(msg.trim()) || /\bdeu$/.test(msg.trim())) return true;

  const parciais = [
    "agora foi","agora deu","deu certo","foi sim",
    "funcionou","resolveu","resolvido","consegui","conectou",
    "ta funcionando","tá funcionando","ta ok","tá ok",
    "tudo certo","tudo ok","ja foi","já foi",
    "funcionando agora","conectado","deu sim","sim deu",
    "deu boa","foi isso","agora sim","ahhh agora","ahh agora",
    "agora conectou","ja conectou","já conectou","respondeu",
    "deu ja","deu já","ja deu","já deu",
    "foi la","foi lá","era isso","era so","era só",
    "agora apareceu","apareceu o menu","apareceu aqui","abriu o menu",
    "entrou no menu","apareceu a tela","apareceu as opcoes",
    "conectando normalmente","conectou normalmente","esta conectando","está conectando",
    "ta conectando","tá conectando","subiu","voltou a funcionar",
    "otimo","ótimo","perfeito","exato","quero","ta bom",
    "tô vendo","to vendo","apareceu","está funcionando","ta funcionando",
    "esta sim","está sim","sim ta","sim tá","sim esta","sim está",
    "pode sim","claro","com certeza","certeza","positivo",
  ];

  const msgFinal = msg.trim();
  if (msgFinal.includes("descon") || msgFinal.startsWith("nao") || msgFinal.startsWith("não")) return false;
  return parciais.some(w => msgFinal.includes(w));
}

export function isNegative(msg) {
  return [
    "nao","não","erro","falhou","nao deu","não deu","deu errado",
    "nada ainda","ainda nao","ainda não","continua","mesma coisa",
    "fiz tudo","tentei tudo","nao adiantou","não adiantou",
    "nao funcionou","não funcionou","nao resolveu","não resolveu",
    "nao conectou","não conectou","nao aparece","não aparece",
    "nao mudou","não mudou","continua igual","mesmo problema",
    "nao consegui","não consegui","nao foi","nao ta","nao está",
    "nenhum deu","nenhum funcionou","nenhum resolveu","nenhum adiantou",
    "nenhuma funcionou","nada funcionou","nada resolveu","nada adiantou",
    "nada deu certo","nenhum deu certo",
  ].some(w => msg.includes(w)) || msg.trim() === "nada" || msg.trim() === "nao" || msg.trim() === "não" ||
    /\bnop\b/.test(msg) ||
    /\bnegativo\b/.test(msg);
}

export function isManualThanks(msg) {
  return [
    "obrigado","obrigada","obg","valeu","agradecido","agradecida",
    "tchau","tchauu","xau","ate mais","até mais","ate logo","até logo",
    "ate+","até+","ateee","falou","flw","vlw","abraco","abraços",
    "boa tarde a todos","boa noite a todos","ate amanha","até amanhã",
  ].some(w => msg.includes(w));
}

export function looksLikeProblem(msg) {
  return contemAlgum(msg, [
    "nao conecta", "nao conect", "sem conexao", "sem internet",
    "problema", "erro", "travou", "desligou", "nao funciona",
    "nao liga", "caiu", "parou", "nao ta", "nao esta",
    "ajuda", "preciso", "microterminal", "terminal", "micro",
    "nao aparece", "nao abre", "tela preta", "pontinho", "pontinhos",
    "nao salva", "nao salvo", "nao sei", "ip", "configurar",
    "como faco", "como faço", "reiniciar", "religa", "travado"
  ]);
}

export function wantsToSendAudio(msg) {
  return msg.includes("audio") || msg.includes("áudio");
}

export function wantsToSendPhoto(msg) {
  return msg.includes("foto") || msg.includes("imagem") ||
         msg.includes("print") || msg.includes("screenshot") ||
         msg.includes("printscreen") || msg.includes("captura");
}

// ────────────────────────────────────────────────────────────────────
// Name extraction
// ────────────────────────────────────────────────────────────────────

const NAO_NOMES = new Set([
  "meu","eu","sou","me","minha","nome","chamo","chamar","chama",
  "oi","ola","opa","bom","boa","sim","nao","ok","e","eh",
  "pode","de","da","do","um","uma","se","que","por","pra","pro","voce",
]);

function palavraEhNome(limpo) {
  const n = limpo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const v = (n.match(/[aeiou]/g) || []).length;
  const c = (n.match(/[bcdfghjklmnpqrstvwxyz]/g) || []).length;
  const t = n.length;
  return t >= 3 && t <= 20 && v >= 1 && c >= 1 && (c / t) >= 0.20;
}

export function extrairNome(messageOriginal) {
  const palavras = messageOriginal.trim().split(/\s+/);
  for (const palavra of palavras) {
    const limpo = palavra.replace(/[^a-zA-ZÀ-ÿ]/g, "");
    const limpoNorm = limpo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (/^(oi|ol[aá]|opa|hey|hi|eai|bom|boa)/.test(limpoNorm)) continue;
    if (!NAO_NOMES.has(limpoNorm) && palavraEhNome(limpo)) {
      return limpo.charAt(0).toUpperCase() + limpo.slice(1).toLowerCase();
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Repetir passo
// ────────────────────────────────────────────────────────────────────

export function repetirPasso(session) {
  const nome = session.name ? `, ${session.name}` : "";
  switch (session.step) {
    case "ask_name":
      return `Qual é o seu nome? 😊`;
    case "ask_problem":
      return `Me conta o que está acontecendo com o microterminal${nome} 😊`;
    case "ask_ip":
    case "teach_ip":
      return session.ip
        ? `Preciso que você me mande o IP do computador${nome} 😊\n\nSe não souber como encontrar, é só falar *"não sei"* 👍`
        : buildAskIpMsg(session.name);
    case "config_terminal":
      return session.ip
        ? `Você fez os passos no microterminal${nome}?\n\n_(Desligar → ligar → P nos pontinhos → 1 → IP ${session.ip} → Enter → H → 1 para salvar)_\n\nMe avisa como foi 😊`
        : `Me conta o que aparece no microterminal agora${nome} 😊`;
    case "escalation":
      return `Quer que eu chame o suporte humano da ThR${nome}?\n\nResponde *sim* para chamar ou *não* para continuar tentando 😊`;
    case "confirm_done":
      return `Está funcionando normalmente agora${nome}? 😊`;
    default:
      return `Me conta o que está acontecendo com o microterminal${nome} 😊`;
  }
}

// ────────────────────────────────────────────────────────────────────
// Additional helpers used by chat.js
// ────────────────────────────────────────────────────────────────────

export function isManualNegative(msg) {
  return [
    "nao","não","erro","falhou","nao deu","não deu","deu errado",
    "nada ainda","ainda nao","ainda não","continua","mesma coisa",
    "fiz tudo","tentei tudo","nao adiantou","não adiantou",
    "nao funcionou","não funcionou","nao resolveu","não resolveu",
    "nao conectou","não conectou","nao aparece","não aparece",
    "nao mudou","não mudou","continua igual","mesmo problema",
    "nao consegui","não consegui","nao foi","nao ta","nao está",
    "nenhum deu","nenhum funcionou","nenhum resolveu","nenhum adiantou",
    "nenhuma funcionou","nada funcionou","nada resolveu","nada adiantou",
    "nada deu certo","nenhum deu certo",
  ].some(w => msg.includes(w)) || msg.trim() === "nada" || msg.trim() === "nao" || msg.trim() === "não";
}

export function isManualAffirmative(msg) {
  if (isManualNegative(msg)) return false;
  if (/\bnenhum[ao]?\b|\bnada\b/.test(msg)) return false;
  if (msg.includes("tela preta") || msg.includes("tela apagada") ||
      msg.includes("nao conectou") || msg.includes("não conectou") ||
      msg.includes("nao funciona") || msg.includes("nao conecta")) return false;
  const exatos = ["sim","simm","ss","s","aham","uhum","fiz"];
  if (exatos.some(w => msg.trim() === w)) return true;
  if (["foi","deu","conectou","funcionou","resolveu"].includes(msg.trim())) return true;
  if (/\bfoi$/.test(msg.trim()) || /\bdeu$/.test(msg.trim())) return true;
  const parciais = [
    "agora foi","agora deu","deu certo","foi sim",
    "funcionou","resolveu","resolvido","consegui","conectou",
    "ta funcionando","tá funcionando","ta ok","tá ok",
    "tudo certo","tudo ok","ja foi","já foi",
    "funcionando agora","conectado","deu sim","sim deu",
    "deu boa","foi isso","agora sim","ahhh agora","ahh agora",
    "agora conectou","ja conectou","já conectou","respondeu",
    "deu ja","deu já","ja deu","já deu","deu sim","sim deu",
    "foi la","foi lá","era isso","foi isso","era so","era só",
    "agora apareceu","apareceu o menu","apareceu aqui","abriu o menu",
    "entrou no menu","apareceu a tela","apareceu as opcoes",
    "conectando normalmente","conectou normalmente","esta conectando","está conectando",
    "ta conectando","tá conectando","subiu","voltou a funcionar",
    "esta sim","está sim","sim ta","sim tá","sim esta","sim está",
    "pode sim","claro","com certeza","certeza","positivo",
  ];
  const msgFinal = msg.trim();
  if (msgFinal.includes("descon") || msgFinal.startsWith("nao") || msgFinal.startsWith("não")) return false;
  return parciais.some(w => msgFinal.includes(w));
}

export function isManualNeutral(msg) {
  return ["ok","okk","okey","blz","beleza","entendi","ata","ah ta","ah tá","hmm"].some(w => msg.includes(w));
}

export function isManualNoProblem(msg) {
  const semProblema = [
    "nada","de boa","tranquilo",
    "so testando","só testando","testando",
    "ja resolvi","já resolvi",
    "ta ok","tá ok","tudo certo","tudo ok",
    "ta resolvido","tá resolvido",
    "consegui resolver","ja ta bom","já tá bom",
  ];
  const temNegacao = /\bn[aã]o\b|descon|nao foi|nao deu|nao funciona/.test(msg);
  return !temNegacao && semProblema.some(w => msg.includes(w));
}

export function detectErrorType(msg) {
  const networkWords = ["tempo esgotado","esgotado","falha","falhou","sem resposta","nao responde","nao respondeu","rede","cabo","conexao","conexão"];
  const ipWords = ["inacessivel","inacessível","ip errado","host inacessivel","destino inacessivel"];
  if (networkWords.some(w => msg.includes(w))) return "network";
  if (ipWords.some(w => msg.includes(w))) return "ip";
  return null;
}

export function isVagueProblem(msg) {
  return [
    "travou","travando","congelou","parou","nao funciona","não funciona",
    "nao liga","não liga","deu problema","com problema",
    "esconectou","desconectou","desconetou","desconectu","desocneto","desconetoi",
    "caiu","caindo","nao abre","não abre",
    "nao conecta","não conecta","nao pega","não pega",
    "tela preta","piscando","piscou",
    "bugou","bugando","lento","travado","sem sinal",
    "nao responde","não responde","sumiu","nao aparece","não aparece",
    "nao entra","não entra","nao acessa","não acessa",
    "quebrou","quebrando","com erro","deu erro",
    "nao consigo conectar","nao consigo acessar","nao consigo entrar",
    "nao esta conectando","nao ta conectando","nao esta funcionando",
    "problema na rede","problema de rede","sem conexao","sem internet",
    "fora do ar","fora do sistema","nao sobe",
  ].some(w => msg.includes(w));
}

export function forgotToSave(msg) {
  return ["nao salvei","não salvei","esqueci"].some(w => msg.includes(w));
}

// ────────────────────────────────────────────────────────────────────
// Main conversation function
// ────────────────────────────────────────────────────────────────────

/**
 * processConversation — central state machine for the ThR microterminal chatbot.
 *
 * @param {string} msg - Normalized + fuzzy-normalized message
 * @param {string} rawMessage - Original message text (before normalization)
 * @param {object} session - Current session object
 * @param {object} options
 * @param {Function} options.responderComRAG - async (message, name) => string|null
 * @param {Function} options.notificar - async (name, from, ip) => void
 * @param {Function|null} options.isAffirmativeFn - async (msg) => bool|null (overrides sync)
 * @param {Function|null} options.isNegativeFn - async (msg) => bool|null (overrides sync)
 * @returns {{ reply: string, session: object|null, shouldDelete: boolean }}
 */
export async function processConversation(msg, rawMessage, session, options = {}) {
  const {
    responderComRAG = async () => null,
    notificar = async () => {},
    isAffirmativeFn = null,
    isNegativeFn = null,
    chatId = null,
    imageAnalysis = false,
  } = options;

  // ── Analytics instrumentation ──────────────────────────────────────
  const prevStep = session.step;
  logEvent({ type: "message", chatId, step: session.step, msg: msg.slice(0, 80) });
  if (session.step === "start") {
    logEvent({ type: "session_start", chatId });
  }

  // Helpers: use AI override if provided, otherwise sync
  const checkPositive = isAffirmativeFn
    ? async (m) => { const r = await isAffirmativeFn(m); return r !== null ? r : isPositive(m); }
    : async (m) => isPositive(m);

  const checkNegative = isNegativeFn
    ? async (m) => { const r = await isNegativeFn(m); return r !== null ? r : isNegative(m); }
    : async (m) => isNegative(m);

  let reply = "";

  switch (session.step) {

    // ── start ────────────────────────────────────────────────────
    case "start": {
      const s = saudacaoHorario();
      if (session.name) {
        // Nome já conhecido (veio do perfil WhatsApp) — pula direto para o problema
        session.step = "ask_problem";
        const intro = isBusinessHours()
          ? `${s}! 😊 Sou a assistente virtual do microterminal da ThR.`
          : MSG_FORA_HORARIO.trim();
        reply = `${intro}\n\nPrazer, ${session.name}! 👋 Pode me dizer o que aconteceu com o microterminal?`;
      } else {
        session.step = "ask_name";
        if (isBusinessHours()) {
          reply = pick(
            `${s}! 😊 Sou a assistente virtual do microterminal da ThR.\n\nQual seu nome?`,
            `${s}! 👋 Aqui é a assistente da ThR — estou aqui pra te ajudar com o microterminal!\n\nQual seu nome pra começar?`,
            `${s}! 😄 Pode me chamar de assistente ThR, sou responsável pelo suporte do microterminal.\n\nQual seu nome? 👍`,
          );
        } else {
          reply = `${MSG_FORA_HORARIO}${pick(
            `Qual seu nome?`,
            `Me conta qual seu nome pra começar 😊`,
            `Qual seu nome? 😊`,
          )}`;
        }
      }
      break;
    }

    // ── ask_name ─────────────────────────────────────────────────
    case "ask_name": {
      const saudacoes = ["oi","ola","olá","hey","hi","bom dia","boa tarde","boa noite","opa","eai","e ai"];
      const ehSaudacao = saudacoes.some(s => msg.trim() === s)
        || /^p?o+i+[eu]?$/.test(msg.trim())
        || /^ol+[aá]+$/.test(msg.trim())
        || /^e+i+$/.test(msg.trim())
        || /^[oiu][io]+$/.test(msg.trim());

      if (ehSaudacao) {
        reply = `Oi! 😄\n\nQual é o seu nome?`;
        break;
      }

      if (isManualNoProblem(msg)) {
        return { reply: `Tudo certo! 😊\n\nSe precisar de ajuda com o microterminal, é só chamar 👍`, session: null, shouldDelete: true };
      }

      // Se a mensagem parece descrição de problema, pula a pergunta de nome
      if (looksLikeProblem(msg) || isVagueProblem(msg)) {
        const ipDireto = extrairIP(msg);
        if (ipDireto) {
          session.ip = ipDireto;
          session.attempts = 0;
          session.step = "config_terminal";
          reply = buildConfigMsg(session.ip);
        } else {
          session.step = "ask_ip";
          reply = pick(
            `Entendi! Vamos verificar a configuração 👍\n\nVocê sabe o IP do computador?`,
            `Certo! Para resolver, preciso do IP do computador.\n\nVocê sabe qual é?`,
          );
        }
        break;
      }

      const nomeAsk = extrairNome(rawMessage);
      if (!nomeAsk) {
        reply = `Pode me dizer seu nome? 😊`;
      } else {
        session.name = nomeAsk;
        session.step = "ask_problem";
        reply = pick(
          `Prazer, ${session.name}! 😊\n\nPode me dizer o que aconteceu?`,
          `Prazer, ${session.name}! 👋\n\nMe conta o que está rolando com o microterminal?`,
          `Prazer, ${session.name}! 😄\n\nO que está acontecendo? Pode me contar!`,
        );
      }
      break;
    }

    // ── ask_problem ───────────────────────────────────────────────
    case "ask_problem": {
      // Correção de nome
      const temContextoNome = msg.includes("nome") || msg.includes("chamo") || msg.includes("me chamo");
      const todosNomesMsg   = temContextoNome ? [...msg.matchAll(/\be\s+([a-zA-ZÀ-ÿ]{3,20})\b/g)] : [];
      const nomeCorrigido   = todosNomesMsg.length > 0 ? todosNomesMsg[todosNomesMsg.length - 1][1] : null;
      if (nomeCorrigido) {
        session.name = nomeCorrigido.charAt(0).toUpperCase() + nomeCorrigido.slice(1).toLowerCase();
        reply = `Anotado, ${session.name}! 😊\n\nMe conta o que está acontecendo com o microterminal?`;
        break;
      }

      // IP direto no problema
      const ipNoProblem = extrairIP(msg);
      if (ipNoProblem && !wantsToSendAudio(msg) && !wantsToSendPhoto(msg)) {
        session.ip = ipNoProblem;
        session.attempts = 0;
        session.step = "config_terminal";
        reply = buildConfigMsg(session.ip);
        break;
      }

      // Áudio
      if (wantsToSendAudio(msg)) {
        reply = `Aqui pelo chat não consigo receber áudios 😊\n\nMas pode digitar o que está acontecendo que te ajudo normalmente 👍`;
        break;
      }

      // Suporte humano direto
      if (contemAlgum(msg, ["suporte","tecnico","técnico","quero ajuda","falar com alguem","falar com alguém","atendente","humano"])) {
        session.step = "escalation";
        reply = `Claro! Posso te colocar na fila de *suporte humano* da ThR — um técnico entra em contato aqui pelo WhatsApp ou por ligação 👨‍🔧\n\nQuer isso? Responde *sim* ou *não*`;
        break;
      }

      // Saudação ou mensagem muito curta
      const saudacoesProb = ["oi","ola","olá","hey","hi","bom dia","boa tarde","boa noite","opa","eai","e ai","ok","blz","beleza"];
      if (saudacoesProb.some(s => msg.trim() === s) || msg.trim().length <= 2) {
        reply = `Pode me contar o que está acontecendo com o microterminal, ${session.name || ""}? 😊`;
        break;
      }

      // Nenhum problema
      if (isManualNoProblem(msg)) {
        return { reply: `Ahh perfeito ${session.name || ""}! 😄\n\nEntão já está tudo certo 👍\n\nSe precisar de ajuda com o microterminal depois, é só me chamar 😉`, session: null, shouldDelete: true };
      }

      // Foto/print
      if (!imageAnalysis && wantsToSendPhoto(msg)) {
        reply = `Claro, pode mandar! 📸\n\nSó que pelo chat de texto eu não consigo receber imagens diretamente.\n\nMe descreve o que aparece? Por exemplo:\n- Tem alguma mensagem de erro na tela?\n- Alguma luz diferente acesa no equipamento?\n- A tela está preta, travada ou piscando?\n\nAssim já consigo te ajudar 😊`;
        break;
      }

      // Tela preta
      if (contemAlgum(msg, ["tela preta","tela apagada","sem imagem","tela nao liga","tela não liga","monitor apagado","nao aparece nada","não aparece nada na tela"])) {
        session.step = "ask_ip";
        reply = pick(
          `Tela preta geralmente tem solução rápida, ${session.name}! 😊\n\n🔌 Primeiro conferes:\n• O cabo de vídeo está bem encaixado nos dois lados?\n• O microterminal está ligado na tomada?\n• A TV/monitor está na entrada certa?\n\nSe tudo estiver ok e continuar sem imagem, vamos checar a configuração de rede 👇\n\nVocê sabe o IP do computador?`,
          `Entendido, ${session.name}! 📺 Tela preta pode ser coisa simples:\n\n1️⃣ Confere o *cabo de vídeo* — tira e recoloca firme\n2️⃣ Verifica se o *microterminal está ligado* na tomada\n3️⃣ Testa a *entrada correta* na TV ou monitor\n\nSe continuar, vamos verificar a rede também 👇\n\nVocê tem o IP do computador?`,
        );
        break;
      }

      // Teclado não funciona
      if (contemAlgum(msg, ["teclado nao funciona","teclado não funciona","teclas nao funcionam","teclas não funcionam","nao digita","não digita","teclado nao responde","teclado não responde","teclado travado"])) {
        reply = pick(
          `Problema com o teclado tem uma causa muito comum no microterminal, ${session.name}! 😊\n\n⚠️ O teclado *precisa estar conectado ANTES de ligar* o equipamento.\n\nTenta assim:\n1️⃣ *Desligue* o microterminal\n2️⃣ *Pluga o teclado* com a máquina desligada\n3️⃣ *Ligue* novamente\n\nFuncionou? 😊`,
          `Entendido, ${session.name}! 🖮 O microterminal precisa que o teclado esteja conectado *antes de ligar* — isso é super importante!\n\nFaz assim:\n• *Desliga* o microterminal\n• *Encaixa o teclado* com a máquina desligada\n• *Liga* novamente\n\nMe avisa se funcionou 👍`,
        );
        break;
      }

      // Senha / acesso
      if (contemAlgum(msg, ["senha","password","acesso negado","esqueci a senha","esqueci minha senha","nao lembro a senha","não lembro a senha","usuario e senha","usuário e senha","usuario incorreto","usuário incorreto"])) {
        session.step = "escalation";
        reply = pick(
          `Entendido, ${session.name}! 🔐 Senhas e acessos do microterminal são gerenciados pela equipe da ThR.\n\nVou te colocar na fila de *suporte humano* pra um técnico te ajudar rapidinho.\n\nQuer isso? Responde *sim* ou *não* 😊`,
          `Senhas são com a equipe da ThR, ${session.name}! 🔑\n\nNão consigo redefinir por aqui, mas posso chamar o suporte agora.\n\nQuer que eu chame? Responde *sim* ou *não* 😊`,
        );
        break;
      }

      // Terminal muito lento
      if (contemAlgum(msg, ["muito lento","super lento","ficando lento","fica muito lento","extremamente lento"])) {
        session.step = "ask_ip";
        reply = pick(
          `Lentidão no microterminal geralmente é de rede, ${session.name}! 😊\n\nVamos verificar a configuração 👇\n\nVocê sabe o IP do computador?`,
          `Entendido, ${session.name}! Lentidão pode ser configuração de IP ou problema na rede.\n\nVocê tem o IP do servidor em mãos?`,
        );
        break;
      }

      // Problema vago mas reconhecível
      if (isVagueProblem(msg)) {
        session.step = "ask_ip";
        reply = `Entendi, vamos resolver isso 👍\n\nVocê sabe o IP do computador?`;
        break;
      }

      // RAG / clarificação
      {
        const respostaRAG = await responderComRAG(rawMessage, session.name);
        if (respostaRAG) {
          session.step = "rag_followup";
          reply = `${respostaRAG}\n\n---\nIsso resolveu seu problema? 😊`;
        } else if (!session.clarificationAsked) {
          session.clarificationAsked = true;
          logEvent({ type: "clarification", chatId, msg: msg.slice(0, 120) });
          reply = (
            `Hmm, não entendi muito bem 😊\n\n` +
            `Pode me contar melhor o que está acontecendo com o microterminal?\n\n` +
            `Por exemplo:\n` +
            `• O terminal está desconectado / não conecta na rede?\n` +
            `• Aparece alguma mensagem de erro na tela?\n` +
            `• É uma dúvida sobre como configurar?\n` +
            `• Outra coisa?\n\n` +
            `Com mais detalhes consigo te ajudar melhor 👍`
          );
        } else {
          session.step = "ask_ip";
          reply = `Entendido! Vamos verificar a configuração 👍\n\nVocê sabe o IP do computador?`;
        }
      }
      break;
    }

    // ── rag_followup ──────────────────────────────────────────────
    case "rag_followup": {
      if (await checkPositive(msg)) {
        logEvent({ type: "resolved", chatId, name: session.name, via: "rag" });
        return {
          reply: pick(
            `Boa, ${session.name}! 🎉\n\nFico feliz que ajudou 😄\n\nQualquer coisa, é só chamar!`,
            `Que ótimo, ${session.name}! 🙌\n\nFico feliz que resolveu!\n\nEstou aqui sempre que precisar, é só chamar 😊`,
          ),
          session: null,
          shouldDelete: true,
        };
      } else if (await checkNegative(msg)) {
        session.step = "ask_ip";
        reply = `Entendido, vamos verificar mais a fundo 👇\n\nVocê sabe o IP do computador?`;
      } else {
        const novaResposta = await responderComRAG(rawMessage, session.name);
        if (novaResposta) {
          reply = `${novaResposta}\n\n---\nIsso ajudou? 😊`;
        } else {
          session.step = "ask_ip";
          reply = `Deixa eu te ajudar pelo fluxo completo 👇\n\nVocê sabe o IP do computador?`;
        }
      }
      break;
    }

    // ── ask_ip ────────────────────────────────────────────────────
    case "ask_ip": {
      // Suporte humano
      if (contemAlgum(msg, ["suporte","tecnico","técnico","quero ajuda","falar com alguem","falar com alguém","atendente","humano"])) {
        session.step = "escalation";
        reply = `Claro! Posso te colocar na fila de *suporte humano* da ThR — um técnico entra em contato aqui pelo WhatsApp ou por ligação 👨‍🔧\n\nQuer isso? Responde *sim* ou *não*`;
        break;
      }

      // Áudio
      if (wantsToSendAudio(msg)) {
        reply = `Aqui pelo chat não consigo receber áudios 😊\n\nPode digitar o IP do computador? É um número assim: *192.168.x.x* 👍`;
        break;
      }

      const ipDiretoAsk = extrairIP(msg);
      const seiPositivo = msg.includes("sei") &&
        !msg.includes("sei nada") && !msg.includes("sei la") &&
        !msg.includes("sei nao") && !msg.includes("sei não") &&
        !msg.includes("nao sei") && !msg.includes("não sei");

      if (ipDiretoAsk) {
        session.ip = ipDiretoAsk;
        session.attempts = 0;
        session.step = "config_terminal";
        reply = buildConfigMsg(session.ip);
      } else if (await checkPositive(msg) || (!await checkNegative(msg) && (seiPositivo || msg.includes("tenho") || msg.includes("aqui")))) {
        session.step = "teach_ip";
        reply = `Ótimo! Pode me mandar o IP 😊`;
      } else {
        session.step = "teach_ip";
        reply = `Sem problema! Vamos pegar o IP juntos 👇\n\n1. Aperte a tecla Windows 🪟\n2. Digite: cmd\n3. Abra\n4. Digite: ipconfig\n5. Procure por "IPv4"\n\nMe manda aqui quando achar 👍`;
      }
      break;
    }

    // ── teach_ip ──────────────────────────────────────────────────
    case "teach_ip": {
      const ipTeach = extrairIP(msg);

      // Desistência
      if (contemAlgum(msg, ["nao quero mais","não quero mais","desisti","deixa pra la","deixa pra lá","esquece","cancela","para","nao quero","não quero"])) {
        session.step = "escalation";
        reply = `Sem problema! Posso te colocar na fila de *suporte humano* da ThR — um técnico resolve isso com você 👨‍🔧\n\nQuer isso? Responde *sim* ou *não*`;
        break;
      }

      // "tempo esgotado" — resultado de ping
      if (msg.includes("tempo esgotado") || msg.includes("time out") || msg.includes("timeout") || msg.includes("sem resposta")) {
        reply = `"Tempo esgotado" significa que o computador não está alcançando esse endereço — pode ser IP errado ou problema de rede 🌐\n\nPrimeiro vamos confirmar o IP correto:\n1. Abre o *cmd*\n2. Digita *ipconfig*\n3. Me manda o número do *Endereço IPv4*\n\nÉ um número tipo *192.168.x.x* 😊`;
        break;
      }

      // IP especial (APIPA / loopback) — não serve para configurar
      if (ipTeach && !isValidConfigIP(ipTeach)) {
        reply = (
          `Hmm, *${ipTeach}* é um endereço especial que não funciona para configurar o microterminal 😕\n\n` +
          `Precisamos do *Endereço IPv4* da máquina servidora — costuma ser algo como *192.168.x.x* ou *10.x.x.x*.\n\n` +
          `No cmd, digita *ipconfig* e procura a linha *Endereço IPv4* (não IPv6) 😊\n\n` +
          `Me manda o número quando encontrar!`
        );
        break;
      }

      if (ipTeach) {
        session.ip = ipTeach;
        session.attempts = 0;
        session.step = "config_terminal";
        reply = buildConfigMsg(session.ip);
        break;
      }

      // Celular/telefone — redireciona para o computador
      if (msg.includes("celular") || msg.includes("telefone") || msg.includes("smartphone") || msg.includes("android") || msg.includes("iphone")) {
        reply = (
          `O IP que precisamos é do *computador servidor* — não do celular 😊\n\n` +
          `No computador:\n1. Aperta *Windows + R*\n2. Digita *cmd* e Enter\n3. Digita *ipconfig* e Enter\n4. Procura *Endereço IPv4*\n\n` +
          `Me manda o número quando achar 👍`
        );
        break;
      }

      // Só aparece IPv6 e não IPv4
      if (
        msg.includes("ipv6") && (
          msg.includes("nao tem") || msg.includes("so tem") || msg.includes("so aparece") ||
          msg.includes("nao aparece") || msg.includes("nao encontrei") || msg.includes("so ipv6")
        )
      ) {
        reply = (
          `Se só aparece IPv6 e não IPv4, é normal — significa que o adaptador atual não tem endereço IPv4 configurado 😊\n\n` +
          `Procura no *ipconfig* pela seção:\n` +
          `🔹 *Ethernet* ou *Local Area Connection* (cabo de rede)\n` +
          `_(Pula as seções com "Tunnel Adapter" ou "Loopback")_\n\n` +
          `Se tiver WiFi e cabo, usa o IPv4 do *cabo de rede* 👍\n\n` +
          `Me manda o número quando encontrar!`
        );
        break;
      }

      if (await checkNegative(msg)) {
        session.attempts = (session.attempts || 0) + 1;
        if (session.attempts === 1) {
          reply = `Tenta assim:\n\n▶ Aperta *Windows + R*\n▶ Digita *cmd* e Enter\n▶ Digita *ipconfig* e Enter\n▶ Procura *Endereço IPv4*\n\nÉ um número tipo *192.168.x.x* — me manda quando achar 👍`;
        } else if (session.attempts === 2) {
          reply = `Difícil de achar? Tudo bem — me conta o que aparece na tela quando abre o cmd e digita *ipconfig* 😊\n\nDescreve o que você vê que eu te ajudo a identificar o número certo 👍`;
        } else {
          session.step = "escalation";
          reply = `Entendo que está difícil encontrar o IP 😕\n\nPosso te colocar na fila de *suporte humano* da ThR — um técnico entra em contato e te ajuda remotamente a localizar tudo 👨‍🔧\n\nQuer isso? Responde *sim* ou *não*`;
        }
        break;
      }

      // Múltiplos IPs
      if (contemAlgum(msg, ["dois ip","varios ip","vários ip","2 ip","dois endere","varios numero","vários numero","varios num","apareceu varios","apareceu vários","varios aqui","apareceu mais"])) {
        reply = (
          `Se apareceram vários números, procura o *Endereço IPv4* — costuma ter esse formato: *192.168.x.x* 😊\n\n` +
          `Se aparecer mais de um (por exemplo WiFi e cabo de rede), usa o do *cabo de rede* (geralmente chamado *Ethernet* ou *Local Area Connection*) 👍\n\n` +
          `Me manda o número quando encontrar!`
        );
        break;
      }

      // RAG fallback
      {
        const respostaRAGIp = await responderComRAG(rawMessage, session.name);
        if (respostaRAGIp) {
          reply = `${respostaRAGIp}\n\n---\nConseguiu o IP? 😊`;
        } else {
          reply = `Pode me mandar o IP 👍\n\nSe não souber como encontrar, é só falar que eu te ajudo 😊`;
        }
      }
      break;
    }

    // ── config_terminal ───────────────────────────────────────────
    case "config_terminal": {
      const errorType = detectErrorType(msg);
      const ipNovoConfig = extrairIP(msg);

      // Se chegou aqui sem IP mas mandou um IP novo, usa-o
      if (!session.ip && ipNovoConfig) {
        session.ip = ipNovoConfig;
        session.attempts = 0;
        reply = buildConfigMsg(session.ip);
        break;
      }

      // Sem IP e sem IP na mensagem, volta para teach_ip
      if (!session.ip) {
        session.step = "teach_ip";
        session.attempts = 0;
        reply = `Ainda preciso do IP pra continuar 😊\n\n${buildAskIpMsg(session.name)}`;
        break;
      }

      // Suporte humano
      if (contemAlgum(msg, ["presencial","remoto","suporte","tecnico","técnico","quero ajuda","nao consigo","não consigo","pode me ligar","me liga","me ligue","me ligar","quer ligar","voce liga","você liga"])) {
        session.step = "escalation";
        reply = `Entendido 😊\n\nPosso te colocar na fila de *suporte humano* da ThR — um técnico entra em contato aqui pelo WhatsApp ou por ligação para te ajudar remotamente 👨‍🔧\n\nQuer que eu faça isso? Responde *sim* ou *não*`;
        break;
      }

      // Pedindo senha no menu — precisa de suporte humano
      if (contemAlgum(msg, ["senha","pedindo senha","pede senha","pedir senha","pediu senha","quer senha","exige senha"])) {
        session.step = "escalation";
        reply = `Se o menu está pedindo senha, isso é gerenciado pela equipe da ThR 🔐\n\nPosso te colocar na fila de *suporte humano* — um técnico te ajuda com a senha do menu de configuração 👨‍🔧\n\nQuer isso? Responde *sim* ou *não*`;
        break;
      }

      // Pergunta sobre tempo
      if (contemAlgum(msg, ["quanto tempo","quanto demora","demora muito","demora quanto","leva quanto","leva muito tempo","quanto leva"])) {
        reply = `É bem rápido — em geral menos de 1 minuto! 😊\n\nDepois de salvar (H → 1), o microterminal reinicia automaticamente e já tenta conectar.\n\nSe em 2 minutinhos ainda não conectar, me avisa que a gente verifica 👍`;
        break;
      }

      // Esqueceu de salvar
      if (forgotToSave(msg)) {
        reply = `Após digitar o IP e pressionar Enter, aperta *H* e depois *1* para salvar 😊`;
        break;
      }

      // Foto
      if (!imageAnalysis && wantsToSendPhoto(msg)) {
        reply = `Pelo chat de texto não consigo receber imagens 😊\n\nPode descrever o que aparece na tela do microterminal? Por exemplo, tem alguma mensagem de erro? 👍`;
        break;
      }

      // Novo IP enviado
      if (ipNovoConfig && ipNovoConfig !== session.ip) {
        const jaTeveIp = !!session.ip;
        session.ip = ipNovoConfig;
        reply = buildConfigMsg(session.ip, jaTeveIp);
        break;
      }

      // Não conseguiu pressionar P a tempo
      if (contemAlgum(msg, ["nao consegui","não consegui","passou rapido","passou rápido","perdi","nao deu tempo","nao apareceu pontinho","não apareceu"])) {
        reply = (
          `Não tem problema! Tenta assim:\n\n` +
          `1️⃣ *Conferes se o teclado está plugado* no microterminal antes de ligar\n` +
          `   _(sem teclado conectado, o P não funciona)_\n` +
          `2️⃣ Desligue o microterminal\n` +
          `3️⃣ *Antes de ligar*, posicione o dedo já na tecla *P*\n` +
          `4️⃣ Ligue e pressione o *P imediatamente* assim que ligar\n\n` +
          `A janela dos pontinhos é bem rápida — com o dedo já posicionado fica muito mais fácil 😊`
        );
        break;
      }

      // Mid-config: entrou no menu (ANTES do isPositive check)
      // "pressionei/pressionou + menu" = acabou de abrir o menu, ainda está no meio do config
      if (
        msg.includes("menu") && (
          (msg.includes("entrei") || msg.includes("entrou") || msg.includes("entrar")) ||
          (msg.includes("consegui") && /entr/.test(msg)) ||
          (msg.includes("configurac") || /\bconfig\b/.test(msg)) ||
          msg.includes("pressionei") || msg.includes("pressionou")
        )
      ) {
        reply = (
          `Ótimo, tá no caminho certo! 👍\n\n` +
          `Agora siga os passos dentro do menu:\n\n` +
          `4️⃣ Pressione *1* (IP do servidor)\n` +
          `5️⃣ Digite o IP: *${session.ip}*\n` +
          `6️⃣ Pressione *Enter*\n` +
          `7️⃣ Pressione *H*\n` +
          `8️⃣ Pressione *1* para salvar\n\n` +
          `Me avisa como foi 😊`
        );
        break;
      }

      // Está pedindo para digitar o IP
      if (
        msg.includes("pedindo") && (
          msg.includes("ip") || msg.includes("numero") ||
          msg.includes("número") || msg.includes("digitar") || msg.includes("digita")
        )
      ) {
        reply = (
          `Isso mesmo, agora digita o IP! 👍\n\n` +
          `➡️ *${session.ip || "o IP do computador"}*\n\n` +
          `Depois:\n` +
          `6️⃣ Pressione *Enter*\n` +
          `7️⃣ Pressione *H*\n` +
          `8️⃣ Pressione *1* para salvar 😊`
        );
        break;
      }

      // Errou o IP
      if (
        msg.includes("errei") ||
        (msg.includes("errado") && msg.includes("ip")) ||
        (msg.includes("errado") && msg.includes("digit")) ||
        msg.includes("digitei errado") || msg.includes("coloquei errado")
      ) {
        reply = (
          `Sem problema, é só refazer! 😊\n\n` +
          `No menu:\n` +
          `4️⃣ Pressione *1* (IP do servidor)\n` +
          `5️⃣ Digite com calma: *${session.ip}*\n` +
          `6️⃣ Pressione *Enter*\n` +
          `7️⃣ Pressione *H*\n` +
          `8️⃣ Pressione *1* para salvar\n\n` +
          `_(Se precisar entrar no menu de novo: desligue, ligue e pressione P nos pontinhos)_ 👍`
        );
        break;
      }

      // Tela preta — problema, nunca positivo
      if (msg.includes("tela preta") || msg.includes("tela apagada") || msg.includes("aparece preta")) {
        session.attempts = Math.min((session.attempts || 0) + 1, 99);
        reply = (
          `Tela preta depois de configurar geralmente é IP errado ou cabo solto 🔌\n\n` +
          `🔹 *Confere o IP* — roda o \`ipconfig\` no computador e confirma se é *${session.ip || "o IP que usou"}*\n` +
          `🔹 *Tira e recoloca o cabo de rede* do microterminal\n` +
          `_(Se o computador tiver WiFi e cabo, usa o IP do cabo de rede)_\n\n` +
          `Tenta de novo e me avisa 😊`
        );
        break;
      }

      // Salvou mas voltou para tela preta
      if (contemAlgum(msg, ["voltou pra tela preta","voltou para tela preta","voltou pra tela","ficou tela preta","tela voltou","voltou preta"])) {
        session.attempts = Math.min((session.attempts || 0) + 1, 99);
        reply = (
          `Hmm, voltou para a tela preta depois de salvar 🤔\n\n` +
          `Isso geralmente acontece quando o IP está errado ou o cabo de rede está solto.\n\n` +
          `Vamos verificar:\n` +
          `🔹 *Conferes o IP* — rode o \`ipconfig\` no computador e confirme o número (*${session.ip}*)\n` +
          `🔹 *Tira e recoloca o cabo de rede* do microterminal\n` +
          `_(Se o computador tiver WiFi e cabo, use o IP do *cabo*)_\n\n` +
          `Tenta de novo e me conta como foi 😊`
        );
        break;
      }

      // Afirmativo — funcionou
      if (await checkPositive(msg)) {
        session.step = "confirm_done";
        reply = `Boa 👍\n\nSó pra confirmar: está funcionando normalmente agora? 😊`;
        break;
      }

      // Negativo — não funcionou
      if (await checkNegative(msg)) {
        session.attempts = Math.min((session.attempts || 0) + 1, 99);

        if (errorType === "ip") {
          reply = `Confere o IP 👀\n\nPode estar digitado errado. Refaz o processo:\n\n${buildConfigMsg(session.ip, true)}`;
        } else if (errorType === "network") {
          reply = `Parece problema de rede 🌐\n\n🔹 O IP digitado foi *${session.ip}* — confere se está certo\n🔹 Tira e recoloca o cabo de rede do microterminal\n_(Se o computador tiver WiFi e cabo, use o IP do *cabo*)_\n\nAinda não conectou? Me conta 😊`;
        } else if (session.attempts === 1) {
          reply = (
            `Vamos checar 👇\n\n` +
            `🔹 *IP correto?*\nO IP que você usou foi *${session.ip}* — confere com o ipconfig\n_(Se aparecer WiFi e cabo, use o IP do *cabo de rede*)_\n\n` +
            `🔹 *Pressinou P na hora certa?*\nDesligue e ligue de novo, com o dedo já posicionado no P antes de ligar\n\n` +
            `🔹 *Cabo de rede* 🔌\nTira e recoloca o cabo do terminal\n\n` +
            `Me conta o que aparece agora 😊`
          );
        } else if (session.attempts === 2) {
          reply = (
            `Ainda não foi 😕 Tenta assim:\n\n` +
            `1️⃣ *Desplugue* da tomada\n` +
            `2️⃣ Aguarde *30 segundos*\n` +
            `3️⃣ Religue e pressione *P* nos pontinhos\n` +
            `4️⃣ Pressione *1*, digite *${session.ip}*, Enter, H, 1 para salvar\n\n` +
            `Funcionou? 😊`
          );
        } else {
          session.step = "escalation";
          reply = (
            `Entendo que está sendo difícil 😕\n\n` +
            `Já tentamos várias vezes e o problema persiste.\n\n` +
            `Posso te colocar na fila de *suporte humano* da ThR — um técnico entra em contato aqui pelo WhatsApp para te ajudar 👨‍🔧\n\n` +
            `Quer que eu faça isso? Responde *sim* ou *não*`
          );
        }
        break;
      }

      // Neutro
      if (isManualNeutral(msg)) {
        reply = session.ip
          ? `Conseguiu conectar ou ainda não? 😊`
          : `Me manda o IP pra gente continuar 😊`;
        break;
      }

      // Fallback
      {
        const errorTypeAmbig = detectErrorType(msg);
        if (errorTypeAmbig === "network") {
          session.attempts = Math.min((session.attempts || 0) + 1, 99);
          reply = `Parece problema de rede 🌐\n\nO computador não está alcançando o IP *${session.ip || "configurado"}*.\n\nPode ser:\n- IP digitado errado no microterminal\n- Cabo solto ou com defeito\n- WiFi e cabo: certifica que usou o IP do *cabo*\n\nTira o cabo, coloca de novo firme, e tenta de novo 👍`;
        } else if (errorTypeAmbig === "ip") {
          reply = `Confere o IP 👀\n\nTenta digitar novamente *${session.ip || "o IP correto"}* e salvar (H → 1) 👍`;
        } else {
          const respostaRAGConfig = await responderComRAG(rawMessage, session.name);
          if (respostaRAGConfig) {
            reply = `${respostaRAGConfig}\n\n---\nIsso ajudou ou ainda está com problema? 😊`;
          } else {
            reply = `Pode me contar melhor o que está aparecendo? 😊\n\nPor exemplo:\n- Não conseguiu pressionar P a tempo?\n- Salvou mas não conectou?\n- Aparece alguma mensagem de erro?`;
          }
        }
      }
      break;
    }

    // ── escalation ────────────────────────────────────────────────
    case "escalation": {
      const descrevePersistencia = [
        "continua igual","mesma coisa","mesmo problema","continua o mesmo",
        "ainda nao resolveu","ainda nao funcionou","ainda com problema",
        "nao mudou nada","igual ainda",
      ].some(w => msg.includes(w));

      const ipEscalation = extrairIP(msg);
      if (ipEscalation) {
        session.ip = ipEscalation;
        session.step = "config_terminal";
        session.attempts = 0;
        reply = buildConfigMsg(session.ip);
        break;
      }

      if (contemAlgum(msg, ["achei o ip","achei ip","encontrei o ip","encontrei ip","tenho o ip","consegui o ip","peguei o ip"])) {
        session.step = "teach_ip";
        reply = `Boa! Me manda o número do IP 😊\n\nÉ no formato *192.168.x.x*`;
        break;
      }

      if (!descrevePersistencia && await checkPositive(msg)) {
        logEvent({ type: "escalation", chatId, name: session.name, ip: session.ip });
        await notificar(session.name, null, session.ip);
        const contatoMsg = isBusinessHours()
          ? `Em breve um técnico entra em contato aqui pelo WhatsApp 🛠️`
          : `Como estamos fora do horário agora, um técnico entra em contato assim que estivermos ON (seg-sex 8h-18h) 🛠️`;
        return {
          reply: `Feito! ✅\n\nVocê está na fila de suporte da ThR.\n\n${contatoMsg}\n\nQualquer dúvida, é só chamar!`,
          session: null,
          shouldDelete: true,
          isTransfer: true,
        };
      } else if (!descrevePersistencia && await checkNegative(msg)) {
        session.step = "config_terminal";
        session.attempts = 1;
        reply = `Tudo bem! Vamos continuar tentando 💪\n\nMe conta o que está aparecendo no microterminal agora?`;
      } else {
        reply = `Para chamar o suporte, responde *sim*.\nSe quiser continuar tentando, responde *não* 😊`;
      }
      break;
    }

    // ── confirm_done ──────────────────────────────────────────────
    case "confirm_done": {
      if (await checkPositive(msg)) {
        logEvent({ type: "resolved", chatId, name: session.name, ip: session.ip });
        session.step = "final";
        reply = pick(
          `Boa ${session.name}! 🎉\n\nFuncionou 😄\n\nQualquer coisa, chama 👍`,
          `Boa ${session.name}! 🙌\n\nFico feliz que deu certo!\n\nEstou aqui se precisar, é só chamar 😊`,
          `Boa ${session.name}! 🎊\n\nJá está tudo funcionando!\n\nQualquer coisa, é só chamar 😄`,
        );
      } else if (await checkNegative(msg)) {
        session.step = "config_terminal";
        reply = `Beleza, então vamos continuar 👇\n\nO que ainda está acontecendo?`;
      } else {
        reply = `Está funcionando agora ou ainda não?`;
      }
      break;
    }

    // ── final ─────────────────────────────────────────────────────
    case "final": {
      return {
        reply: pick(
          `Por nada 😊\n\nSe precisar, é só chamar! 👍`,
          `Por nada! 😄\n\nQualquer coisa, é só chamar 👍`,
          `Por nada, fico feliz em ter ajudado! 😊\n\nEstou sempre por aqui, é só chamar 👍`,
        ),
        session: null,
        shouldDelete: true,
      };
    }

    // ── fallback ──────────────────────────────────────────────────
    default: {
      session.step = "ask_problem";
      reply = `Me conta o que está acontecendo com o microterminal 😊`;
    }
  }

  // ── Log step change if any ─────────────────────────────────────────
  if (session && session.step !== prevStep) {
    logEvent({ type: "step_change", chatId, from: prevStep, to: session.step });
  }

  return { reply, session, shouldDelete: false };
}
