import { Router } from "express";
import { log } from "../services/logger.js";
import { responderComRAG, analisarImagem, classificarIntencao } from "../services/ai.js";
import { getSession, saveSession, deleteSession } from "../services/session.js";
import config from "../config.js";

const router = Router();

// ── Sorteia resposta aleatória (bot mais humano) ──────────────────────
function pick(...opts) {
  return opts[Math.floor(Math.random() * opts.length)];
}

// ── Saudação adequada ao horário de Brasília ─────────────────────────
function saudacaoHorario() {
  const base = process.env.DATE_OVERRIDE ? new Date(process.env.DATE_OVERRIDE) : new Date();
  const now  = new Date(base.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const h    = now.getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")

    // \u2500\u2500 abrevia\u00e7\u00f5es e g\u00edrias \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    .replace(/\bnaum\b/g, "nao")
    .replace(/\bvc\b/g, "voce")
    .replace(/\boq\b/g, "o que")
    .replace(/\bpq\b/g, "porque")
    .replace(/\bmt\b/g, "muito")
    .replace(/\btb\b/g, "tambem")
    .replace(/\bmsm\b/g, "mesmo")
    .replace(/\baki\b/g, "aqui")
    .replace(/\bblz\b/g, "beleza")
    .replace(/\bfds\b/g, "fim de semana")
    .replace(/\bkd\b/g, "cad\u00ea")

    // \u2500\u2500 typos de "sim" \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    .replace(/\bso+m\b/g, "sim")
    .replace(/\bsi+m+\b/g, "sim")
    .replace(/\bsi\b/g, "sim")
    .replace(/\bsium\b/g, "sim")

    // \u2500\u2500 typos de "nao" \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    .replace(/\bnop+\b/g, "nao")
    .replace(/\bneh\b/g, "nao")

    // \u2500\u2500 typos de "ok" \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    .replace(/\bokk+\b/g, "ok")

    // \u2500\u2500 typos de "ainda" \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    .replace(/\baind[sa]?\b/g, "ainda")

    // \u2500\u2500 microterminal (varia\u00e7\u00f5es mais comuns de typo) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    .replace(/\bmicro\s+terminal\b/g, "microterminal")
    .replace(/\bmicroterminau\b/g, "microterminal")
    .replace(/\bmictroterminal\b/g, "microterminal")
    .replace(/\bmircoterminal\b/g, "microterminal")
    .replace(/\bmicrotermianl\b/g, "microterminal")
    .replace(/\bmicrotermial\b/g, "microterminal")
    .replace(/\bm[i\u00ed]croterminal\b/g, "microterminal")

    // \u2500\u2500 termina\u00e7\u00f5es "au" no lugar de "ou"/"al" (regional/informal) \u2500
    .replace(/\bterminau\b/g, "terminal")
    .replace(/\bfuncionau\b/g, "funcionou")
    .replace(/\bconectau\b/g, "conectou")
    .replace(/\bdesligau\b/g, "desligou")
    .replace(/\bligau\b/g, "ligou")
    .replace(/\bsalvau\b/g, "salvou")
    .replace(/\btravau\b/g, "travou")
    .replace(/\bapareceu\b/g, "apareceu") // j\u00e1 \u00e9 correto, mas evita confus\u00e3o
    .replace(/\berradu\b/g, "errado")
    .replace(/\btadu\b/g, "tado")         // ex: "tadu errado" \u2192 "tado errado"

    // \u2500\u2500 typos de "problema" \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    .replace(/\bpoblema\b/g, "problema")
    .replace(/\bporblema\b/g, "problema")
    .replace(/\bproblemon\b/g, "problema")
    .replace(/\bprobrlema\b/g, "problema")

    // \u2500\u2500 typos de "conectar/conex\u00e3o" \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    .replace(/\bconetar\b/g, "conectar")
    .replace(/\bconectar\b/g, "conectar")  // j\u00e1 correto
    .replace(/\bconexaum\b/g, "conexao")
    .replace(/\bkonexao\b/g, "conexao")

    // \u2500\u2500 typos de "configurar" \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    .replace(/\bcofigurar\b/g, "configurar")
    .replace(/\bconfigurau\b/g, "configurou")
    .replace(/\bconfigurou\b/g, "configurou") // j\u00e1 correto

    // \u2500\u2500 typos de "pressionar" \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    .replace(/\bprecionar\b/g, "pressionar")
    .replace(/\bprecionei\b/g, "pressionei")
    .replace(/\bpressionau\b/g, "pressionou");
}

const CLS_CACHE = new Map();
const CLS_CACHE_TTL = 60_000;

async function classificar(msg) {
  const cached = CLS_CACHE.get(msg);
  if (cached && Date.now() - cached.ts < CLS_CACHE_TTL) return cached.result;

  const ai = await classificarIntencao(msg);
  if (ai) {
    CLS_CACHE.set(msg, { result: ai, ts: Date.now() });
    return ai;
  }
  return null;
}

function isManualNegative(msg) {
  return [
    "nao","não","erro","falhou","nao deu","não deu","deu errado",
    "nada ainda","ainda nao","ainda não","continua","mesma coisa",
    // frases de desistência / sem resultado
    "fiz tudo","tentei tudo","nao adiantou","não adiantou",
    "nao funcionou","não funcionou","nao resolveu","não resolveu",
    "nao conectou","não conectou","nao aparece","não aparece",
    "nao mudou","não mudou","continua igual","mesmo problema",
    "nao consegui","não consegui","nao foi","nao ta","nao está",
    // nenhum/nada + verbo → nada funcionou
    "nenhum deu","nenhum funcionou","nenhum resolveu","nenhum adiantou",
    "nenhuma funcionou","nada funcionou","nada resolveu","nada adiantou",
    "nada deu certo","nenhum deu certo",
  ].some(w => msg.includes(w)) || msg.trim() === "nada" || msg.trim() === "nao" || msg.trim() === "não";
}

function isManualAffirmative(msg) {
  if (isManualNegative(msg)) return false;
  // Bloqueia frases onde "nenhum/nada" invalida o afirmativo
  // ex: "nenhum deu certo", "nada funcionou", "nada resolveu"
  if (/\bnenhum[ao]?\b|\bnada\b/.test(msg)) return false;
  const exatos = ["sim","simm","ss","s","aham","uhum","fiz"];
  if (exatos.some(w => msg.trim() === w)) return true;
  if (["foi","deu","conectou","funcionou","resolveu"].includes(msg.trim())) return true;
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
    // variantes de "está conectando / funcionando normalmente"
    "conectando normalmente","conectou normalmente","esta conectando","está conectando",
    "ta conectando","tá conectando","subiu","voltou","voltou a funcionar",
  ];
  // Garante que "conectou"/"funcionou" não deem match em "desconectou"/"não funcionou"
  const msgFinal = msg.trim();
  if (msgFinal.includes("descon") || msgFinal.startsWith("nao") || msgFinal.startsWith("não")) return false;
  return parciais.some(w => msgFinal.includes(w));
}

function isManualThanks(msg) {
  return ["obrigado","obrigada","obg","valeu","agradecido","agradecida","tchau","tchauu"].some(w => msg.includes(w));
}

function isManualNeutral(msg) {
  return ["ok","okk","okey","blz","beleza","entendi","ata","ah ta","ah tá","hmm"].some(w => msg.includes(w));
}

function isManualNoProblem(msg) {
  // Só palavras que significam "não tenho problema nenhum"
  // NÃO incluir palavras como "conectou", "funcionou" etc.
  // pois podem aparecer em "desconectou", "não funcionou"
  const semProblema = [
    "nada","de boa","tranquilo",
    "so testando","só testando","testando",
    "ja resolvi","já resolvi",
    "ta ok","tá ok","tudo certo","tudo ok",
    "ta resolvido","tá resolvido",
    "consegui resolver","ja ta bom","já tá bom",
  ];
  // Garante que a mensagem não contenha negação junto
  const temNegacao = /\bn[aã]o\b|descon|nao foi|nao deu|nao funciona/.test(msg);
  return !temNegacao && semProblema.some(w => msg.includes(w));
}

function forgotToSave(msg) {
  return ["nao salvei","não salvei","esqueci"].some(w => msg.includes(w));
}

// Extrai o primeiro IP válido de dentro de qualquer mensagem
function extractIP(msg) {
  const match = msg.match(/\b((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/);
  return match ? match[0] : null;
}

// Mantido por compatibilidade — agora usa extractIP internamente
function looksLikeIP(msg) {
  return extractIP(msg) !== null;
}

function detectErrorType(msg) {
  const networkWords = ["tempo esgotado","esgotado","falha","falhou","sem resposta","nao responde","nao respondeu","rede","cabo","conexao","conexão"];
  const ipWords = ["inacessivel","inacessível","ip errado","host inacessivel","destino inacessivel"];
  if (networkWords.some(w => msg.includes(w))) return "network";
  if (ipWords.some(w => msg.includes(w))) return "ip";
  return null;
}

// 🔥 MONTA MENSAGEM DE CONFIGURAÇÃO COMPLETA (com passo do P)
function buildConfigMsg(ip, soPassos = false) {
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

// 🔥 VERIFICA SE ESTÁ NO HORÁRIO DE ATENDIMENTO (seg-sex 8h-18h, fuso Brasília)
// DATE_OVERRIDE=2024-01-15T10:00:00 permite simular data/hora nos testes
function isBusinessHours() {
  const base = process.env.DATE_OVERRIDE ? new Date(process.env.DATE_OVERRIDE) : new Date();
  const now  = new Date(base.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const day  = now.getDay();   // 0=Dom, 1=Seg ... 5=Sex, 6=Sáb
  const hour = now.getHours();
  return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
}

const MSG_FORA_HORARIO =
  `Olá! Você está fora do horário de atendimento (seg-sex 8h-18h) 🫤\n\n` +
  `Mas não tem problema, sou um BOT de atendimento e posso te ajudar com dúvidas e problemas pontuais sobre o microterminal. ` +
  `Caso não consigamos resolver hoje, vou registrar seu caso e um técnico entra em contato assim que estivermos ON de novo 😁👍\n\n`;

// 🔥 DETECTA INTENÇÃO DE ENVIAR ÁUDIO
// Simples: basta mencionar "audio" ou "áudio" na mensagem
function wantsToSendAudio(msg) {
  return msg.includes("audio") || msg.includes("áudio");
}

// 🔥 DETECTA INTENÇÃO DE ENVIAR FOTO/PRINT/IMAGEM
// Simples: basta mencionar qualquer uma dessas palavras
function wantsToSendPhoto(msg) {
  return msg.includes("foto") || msg.includes("imagem") ||
         msg.includes("print") || msg.includes("screenshot") ||
         msg.includes("printscreen") || msg.includes("captura");
}

// 🔥 DETECTA PROBLEMAS VAGOS (sem precisar de RAG)
function isVagueProblem(msg) {
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
    // variantes adicionais
    "quebrou","quebrando","com erro","deu erro",
    "nao consigo conectar","nao consigo acessar","nao consigo entrar",
    "nao esta conectando","nao ta conectando","nao esta funcionando",
    "problema na rede","problema de rede","sem conexao","sem internet",
    "fora do ar","fora do sistema","nao sobe",
  ].some(w => msg.includes(w));
}

async function isNewIntent(msg) {
  const ai = await classificar(msg);
  if (ai === "saudacao") return true;
  const clean = msg.trim().toLowerCase();
  return ["oi","ola","opa","eai","iniciar","reiniciar","novo problema"].includes(clean);
}

async function isThanks(msg) {
  const ai = await classificar(msg);
  if (ai === "agradecimento") return true;
  return isManualThanks(msg);
}

async function isNegative(msg) {
  const ai = await classificar(msg);
  if (ai === "negativo") return true;
  return isManualNegative(msg);
}

async function isAffirmative(msg) {
  const ai = await classificar(msg);
  if (ai === "afirmativo") return true;
  return isManualAffirmative(msg);
}

async function isNeutral(msg) {
  const ai = await classificar(msg);
  if (ai === "neutro") return true;
  return isManualNeutral(msg);
}

async function isNoProblem(msg) {
  return isManualNoProblem(msg);
}

// log importado de ../services/logger.js

router.post("/", async (req, res) => {
  try {
    const { message, session_id, image } = req.body || {};
    if (!message || !session_id) {
      return res.status(400).send("Faltando dados");
    }

    // Garante que message é string (previne crashes com arrays/objetos)
    if (typeof message !== "string") {
      return res.status(400).send("Faltando dados");
    }

    log(message);

    // Imagem válida em base64
    if (image?.trim() && image.startsWith("data:image")) {
      const respostaImagem = await analisarImagem(image);
      return res.send(respostaImagem || "Erro ao analisar imagem");
    }

    // Imagem inválida
    if (image?.trim() && !image.startsWith("data:image")) {
      return res.send(`Entendo que você quer me mostrar uma imagem 🖼️\n\nMas aqui pelo chat não dá pra receber imagem dessa forma.\n\nPode descrever o que está acontecendo? 😊`);
    }

    // Normaliza quebras de linha e espaços múltiplos antes de processar
    const msg = normalize(message.replace(/[\r\n]+/g, " ").replace(/\s+/g, " "));

    if (msg === "reset") {
      deleteSession(session_id);
      return res.send("Memória resetada 🔄");
    }

    // Áudio — responde igual em qualquer step da conversa
    if (wantsToSendAudio(msg)) {
      return res.send(`Aqui pelo chat não consigo receber áudios 😊\n\nPode digitar o que você queria falar que te ajudo normalmente 👍`);
    }

    // Foto/imagem — responde igual em qualquer step
    if (wantsToSendPhoto(msg)) {
      return res.send(`Ainda não consigo receber imagens por aqui 😊\n\nMas pode descrever o que aparece na tela que eu te ajudo a identificar o problema 👍`);
    }

    let session = getSession(session_id);
    const now = Date.now();

    // Agradecimento / encerramento
    if (await isThanks(msg)) {
      if (!session) {
        // Sessão já encerrada — silêncio para não ficar em loop
        return res.send("");
      }
      deleteSession(session_id);
      return res.send(pick(
        `Por nada 😊\n\nSe precisar, é só chamar! 👍`,
        `Por nada! 😄\n\nQualquer coisa, é só chamar 👍`,
        `Por nada, fico feliz em ter ajudado! 😊\n\nEstou sempre por aqui, é só chamar 👍`,
      ));
    }

    if (session && now - session.lastInteraction > config.sessionTimeout) {
      deleteSession(session_id);
      session = null;
    }

    // Só reseta se estiver em ask_name ou final (não no meio do atendimento)
    if (session && await isNewIntent(msg) && ["ask_name", "final"].includes(session.step)) {
      deleteSession(session_id);
      session = null;
    }

    if (!session) {
      session = { step: "start", name: null, ip: null, attempts: 0, lastInteraction: now };
    }

    let reply = "";

    // ==========================
    // STEP: START
    // ==========================
    if (session.step === "start") {
      session.step = "ask_name";
      const s = saudacaoHorario();
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

    // ==========================
    // STEP: ASK_NAME
    // ==========================
    else if (session.step === "ask_name") {
      // Se mandou só saudação, pede o nome de novo
      const saudacoes = ["oi","ola","olá","hey","hi","bom dia","boa tarde","boa noite","opa","eai","e ai"];
      if (saudacoes.some(s => msg.trim() === s)) {
        reply = `Oi! 😄\n\nQual é o seu nome?`;
      } else if (isManualNoProblem(msg)) {
        // "só testando", "já resolvi", "de boa" — não tem problema nenhum
        deleteSession(session_id);
        return res.send(`Tudo certo! 😊\n\nSe precisar de ajuda com o microterminal, é só chamar 👍`);
      } else {
        // Palavras que não são nomes (para tratar "meu nome é Ana", "me chamo X" etc.)
        const NAO_NOMES = new Set([
          "meu","eu","sou","me","minha","nome","chamo","chamar","chama",
          "oi","ola","opa","bom","boa","sim","nao","ok","e","eh",
          "pode","de","da","do","um","uma","se","que","por","pra","pro","voce",
        ]);
        // Extrai primeiro token que parece um nome (tem pelo menos 1 letra, não é palavra comum)
        const palavras = message.trim().split(/\s+/);
        let candidato = "";
        for (const palavra of palavras) {
          const limpo     = palavra.replace(/[^a-zA-ZÀ-ÿ]/g, "");
          // Normaliza acentos para comparar com NAO_NOMES (ex: "é" → "e")
          const limpoNorm = limpo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
          if (limpo.length >= 1 && !NAO_NOMES.has(limpoNorm)) {
            candidato = limpo;
            break;
          }
        }
        // Se não encontrou nenhum candidato válido, pede o nome de novo
        if (candidato.length < 1) {
          reply = `Pode me dizer seu nome? 😊`;
        } else {
          session.name = candidato.charAt(0).toUpperCase() + candidato.slice(1).toLowerCase();
          session.step = "ask_problem";
          reply = pick(
            `Prazer, ${session.name}! 😊\n\nPode me dizer o que aconteceu?`,
            `Prazer, ${session.name}! 👋\n\nMe conta o que está rolando com o microterminal?`,
            `Prazer, ${session.name}! 😄\n\nO que está acontecendo? Pode me contar!`,
          );
        }
      }
    }

    // ==========================
    // STEP: ASK_PROBLEM
    // ==========================
    else if (session.step === "ask_problem") {

      // Quer suporte humano direto, sem nem descrever o problema
      if (["suporte","tecnico","técnico","quero ajuda","falar com alguem","falar com alguém","atendente","humano"].some(w => msg.includes(w))) {
        session.step = "escalation";
        reply = `Claro! Posso te colocar na fila de *suporte humano* da ThR — um técnico entra em contato aqui pelo WhatsApp ou por ligação 👨‍🔧\n\nQuer isso? Responde *sim* ou *não*`;
      }

      // Já mandou o IP direto na descrição do problema
      else {
      const ipNoProblem = extractIP(msg);
      if (ipNoProblem && !wantsToSendAudio(msg) && !wantsToSendPhoto(msg)) {
        session.ip = ipNoProblem;
        session.attempts = 0;
        session.step = "config_terminal";
        reply = buildConfigMsg(session.ip);
      }

      // Quer mandar áudio
      else if (wantsToSendAudio(msg)) {
        reply = `Aqui pelo chat não consigo receber áudios 😊\n\nMas pode digitar o que está acontecendo que te ajudo normalmente 👍`;
      }

      // Saudação ou mensagem muito curta
      else if (["oi","ola","olá","hey","hi","bom dia","boa tarde","boa noite","opa","eai","e ai","ok","blz","beleza"].some(s => msg.trim() === s) || msg.trim().length <= 2) {
        reply = `Pode me contar o que está acontecendo com o microterminal, ${session.name || ""}? 😊`;
      }

      // Nenhum problema
      else if (await isNoProblem(msg)) {
        deleteSession(session_id);
        return res.send(`Ahh perfeito ${session.name || ""}! 😄\n\nEntão já está tudo certo 👍\n\nSe precisar de ajuda com o microterminal depois, é só me chamar 😉`);
      }

      // Quer mandar foto/print
      else if (wantsToSendPhoto(msg)) {
        reply = `Claro, pode mandar! 📸\n\nSó que pelo chat de texto eu não consigo receber imagens diretamente.\n\nMe descreve o que aparece? Por exemplo:\n- Tem alguma mensagem de erro na tela?\n- Alguma luz diferente acesa no equipamento?\n- A tela está preta, travada ou piscando?\n\nAssim já consigo te ajudar 😊`;
        // Mantém step em ask_problem até descrever o problema
      }

      // Tela preta / sem imagem
      else if (["tela preta","tela apagada","sem imagem","tela nao liga","tela não liga","monitor apagado","nao aparece nada","não aparece nada na tela"].some(w => msg.includes(w))) {
        session.step = "ask_ip";
        reply = pick(
          `Tela preta geralmente tem solução rápida, ${session.name}! 😊\n\n🔌 Primeiro confere:\n• O cabo de vídeo está bem encaixado nos dois lados?\n• O microterminal está ligado na tomada?\n• A TV/monitor está na entrada certa?\n\nSe tudo estiver ok e continuar sem imagem, vamos checar a configuração de rede 👇\n\nVocê sabe o IP do computador?`,
          `Entendido, ${session.name}! 📺 Tela preta pode ser coisa simples:\n\n1️⃣ Confere o *cabo de vídeo* — tira e recoloca firme\n2️⃣ Verifica se o *microterminal está ligado* na tomada\n3️⃣ Testa a *entrada correta* na TV ou monitor\n\nSe continuar, vamos verificar a rede também 👇\n\nVocê tem o IP do computador?`,
        );
      }

      // Teclado não funciona
      else if (["teclado nao funciona","teclado não funciona","teclas nao funcionam","teclas não funcionam","nao digita","não digita","teclado nao responde","teclado não responde","teclado travado"].some(w => msg.includes(w))) {
        reply = pick(
          `Problema com o teclado tem uma causa muito comum no microterminal, ${session.name}! 😊\n\n⚠️ O teclado *precisa estar conectado ANTES de ligar* o equipamento.\n\nTenta assim:\n1️⃣ *Desligue* o microterminal\n2️⃣ *Pluga o teclado* com a máquina desligada\n3️⃣ *Ligue* novamente\n\nFuncionou? 😊`,
          `Entendido, ${session.name}! 🖮 O microterminal precisa que o teclado esteja conectado *antes de ligar* — isso é super importante!\n\nFaz assim:\n• *Desliga* o microterminal\n• *Encaixa o teclado* com a máquina desligada\n• *Liga* novamente\n\nMe avisa se funcionou 👍`,
        );
      }

      // Senha / acesso
      else if (["senha","password","acesso negado","esqueci a senha","esqueci minha senha","nao lembro a senha","não lembro a senha","usuario e senha","usuário e senha","usuario incorreto","usuário incorreto"].some(w => msg.includes(w))) {
        session.step = "escalation";
        reply = pick(
          `Entendido, ${session.name}! 🔐 Senhas e acessos do microterminal são gerenciados pela equipe da ThR.\n\nVou te colocar na fila de *suporte humano* pra um técnico te ajudar rapidinho.\n\nQuer isso? Responde *sim* ou *não* 😊`,
          `Senhas são com a equipe da ThR, ${session.name}! 🔑\n\nNão consigo redefinir por aqui, mas posso chamar o suporte agora.\n\nQuer que eu chame? Responde *sim* ou *não* 😊`,
        );
      }

      // Terminal muito lento
      else if (["muito lento","super lento","ficando lento","fica muito lento","extremamente lento"].some(w => msg.includes(w))) {
        session.step = "ask_ip";
        reply = pick(
          `Lentidão no microterminal geralmente é de rede, ${session.name}! 😊\n\nVamos verificar a configuração 👇\n\nVocê sabe o IP do computador?`,
          `Entendido, ${session.name}! Lentidão pode ser configuração de IP ou problema na rede.\n\nVocê tem o IP do servidor em mãos?`,
        );
      }

      // Problema vago mas reconhecível — vai direto pro IP
      else if (isVagueProblem(msg)) {
        session.step = "ask_ip";
        reply = `Entendi, vamos resolver isso 👍\n\nVocê sabe o IP do computador?`;
      }

      // Tenta RAG com os documentos
      else {
        const respostaRAG = await responderComRAG(message, session.name);
        if (respostaRAG) {
          session.step = "rag_followup";
          reply = `${respostaRAG}\n\n---\nIsso resolveu seu problema? 😊`;
        } else if (!session.clarificationAsked) {
          // Primeira tentativa sem entender: pede mais detalhes antes de pular pro IP
          session.clarificationAsked = true;
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
          // Segunda tentativa ainda sem entender: vai pro fluxo de IP
          session.step = "ask_ip";
          reply = `Entendido! Vamos verificar a configuração 👍\n\nVocê sabe o IP do computador?`;
        }
      }
      } // fecha else do bloco suporte
    }

    // ==========================
    // STEP: RAG_FOLLOWUP
    // ==========================
    else if (session.step === "rag_followup") {
      if (await isAffirmative(msg)) {
        deleteSession(session_id);
        return res.send(pick(
          `Boa ${session.name}! 🎉\n\nFico feliz que ajudou 😄\n\nQualquer coisa, é só chamar 👍`,
          `Que ótimo, ${session.name}! 🙌\n\nFico feliz que resolveu!\n\nEstou aqui sempre que precisar, é só chamar 😊`,
          `Arrasou, ${session.name}! 🎊\n\nProblema resolvido! 😄\n\nQualquer dúvida, é só chamar 👍`,
        ));
      } else if (await isNegative(msg)) {
        session.step = "ask_ip";
        reply = `Entendido, vamos verificar mais a fundo 👇\n\nVocê sabe o IP do computador?`;
      } else {
        const novaResposta = await responderComRAG(message, session.name);
        if (novaResposta) {
          reply = `${novaResposta}\n\n---\nIsso ajudou? 😊`;
        } else {
          session.step = "ask_ip";
          reply = `Deixa eu te ajudar pelo fluxo completo 👇\n\nVocê sabe o IP do computador?`;
        }
      }
    }

    // ==========================
    // STEP: ASK_IP
    // ==========================
    else if (session.step === "ask_ip") {

      // Quer suporte humano logo de cara
      if (["suporte","tecnico","técnico","quero ajuda","falar com alguem","falar com alguém","atendente","humano"].some(w => msg.includes(w))) {
        session.step = "escalation";
        reply = `Claro! Posso te colocar na fila de *suporte humano* da ThR — um técnico entra em contato aqui pelo WhatsApp ou por ligação 👨‍🔧\n\nQuer isso? Responde *sim* ou *não*`;
      }

      // Áudio
      else if (wantsToSendAudio(msg)) {
        reply = `Aqui pelo chat não consigo receber áudios 😊\n\nPode digitar o IP do computador? É um número assim: *192.168.x.x* 👍`;
      }

      // IP direto (ou embutido no texto)
      else {
        const ipDiretoAsk = extractIP(msg);
        // "sei" sozinho = sabe | "sei nada/lá/não/não sei" = não sabe
        const seiPositivo = msg.includes("sei") &&
          !msg.includes("sei nada") && !msg.includes("sei la") &&
          !msg.includes("sei nao") && !msg.includes("sei não") &&
          !msg.includes("nao sei") && !msg.includes("não sei");
        if (ipDiretoAsk) {
          session.ip = ipDiretoAsk;
          session.attempts = 0;
          session.step = "config_terminal";
          reply = buildConfigMsg(session.ip);
        }
        // Sabe o IP mas não mandou ainda
        else if (await isAffirmative(msg) || (!await isNegative(msg) && (seiPositivo || msg.includes("tenho") || msg.includes("aqui")))) {
          session.step = "teach_ip";
          reply = `Ótimo! Pode me mandar o IP 😊`;
        }
        // Não sabe
        else {
          session.step = "teach_ip";
          reply = `Sem problema! Vamos pegar o IP juntos 👇\n\n1. Aperte a tecla Windows 🪟\n2. Digite: cmd\n3. Abra\n4. Digite: ipconfig\n5. Procure por "IPv4"\n\nMe manda aqui quando achar 👍`;
        }
      }
    }

    // ==========================
    // STEP: TEACH_IP
    // ==========================
    else if (session.step === "teach_ip") {

      const ipTeach = extractIP(msg);

      // Desistência — não quer mais tentar
      if (["nao quero mais","não quero mais","desisti","deixa pra la","deixa pra lá","esquece","cancela","para","nao quero","não quero"].some(w => msg.includes(w))) {
        session.step = "escalation";
        reply = `Sem problema! Posso te colocar na fila de *suporte humano* da ThR — um técnico resolve isso com você 👨‍🔧\n\nQuer isso? Responde *sim* ou *não*`;
      }

      // Mencionou "tempo esgotado" — é resultado de ping, IP provavelmente errado
      else
      if (msg.includes("tempo esgotado") || msg.includes("time out") || msg.includes("timeout") || msg.includes("sem resposta")) {
        reply = `"Tempo esgotado" significa que o computador não está alcançando esse endereço — pode ser IP errado ou problema de rede 🌐\n\nPrimeiro vamos confirmar o IP correto:\n1. Abre o *cmd*\n2. Digita *ipconfig*\n3. Me manda o número do *Endereço IPv4*\n\nÉ um número tipo *192.168.x.x* 😊`;
      }

      else if (ipTeach) {
        session.ip = ipTeach;
        session.attempts = 0;
        session.step = "config_terminal";
        reply = buildConfigMsg(session.ip);
      }

      else if (await isNegative(msg)) {
        session.attempts = (session.attempts || 0) + 1;
        if (session.attempts === 1) {
          reply = `Tenta assim:\n\n▶ Aperta *Windows + R*\n▶ Digita *cmd* e Enter\n▶ Digita *ipconfig* e Enter\n▶ Procura *Endereço IPv4*\n\nÉ um número tipo *192.168.x.x* — me manda quando achar 👍`;
        } else if (session.attempts === 2) {
          reply = `Difícil de achar? Tudo bem — me conta o que aparece na tela quando abre o cmd e digita *ipconfig* 😊\n\nDescreve o que você vê que eu te ajudo a identificar o número certo 👍`;
        } else {
          // Após 3 tentativas sem achar o IP, oferece suporte
          session.step = "escalation";
          reply = `Entendo que está difícil encontrar o IP 😕\n\nPosso te colocar na fila de *suporte humano* da ThR — um técnico entra em contato e te ajuda remotamente a localizar tudo 👨‍🔧\n\nQuer isso? Responde *sim* ou *não*`;
        }
      }

      else {
        const respostaRAGIp = await responderComRAG(message, session.name);
        if (respostaRAGIp) {
          reply = `${respostaRAGIp}\n\n---\nConseguiu o IP? 😊`;
        } else {
          reply = `Pode me mandar o IP 👍\n\nSe não souber como encontrar, é só falar que eu te ajudo 😊`;
        }
      }
    }

    // ==========================
    // STEP: CONFIG_TERMINAL
    // ==========================
    else if (session.step === "config_terminal") {
      const errorType = detectErrorType(msg);
      const ipNovoConfig = extractIP(msg);

      // Quer suporte humano remoto
      if (["presencial","remoto","suporte","tecnico","técnico","quero ajuda","nao consigo","não consigo"].some(w => msg.includes(w))) {
        session.step = "escalation";
        reply = `Entendido 😊\n\nPosso te colocar na fila de *suporte humano* da ThR — um técnico entra em contato aqui pelo WhatsApp ou por ligação para te ajudar remotamente 👨‍🔧\n\nQuer que eu faça isso? Responde *sim* ou *não*`;
      }

      else if (forgotToSave(msg)) {
        reply = `Após digitar o IP e pressionar Enter, aperta *H* e depois *1* para salvar 😊`;
      }

      else if (wantsToSendPhoto(msg)) {
        reply = `Pelo chat de texto não consigo receber imagens 😊\n\nPode descrever o que aparece na tela do microterminal? Por exemplo, tem alguma mensagem de erro? 👍`;
      }

      // Novo IP enviado (ou junto com texto, ex: "é 192.168.1.100")
      else if (ipNovoConfig && ipNovoConfig !== session.ip) {
        const jaTeveIp = !!session.ip; // tinha IP antes? só omite "Anotei" se sim
        session.ip = ipNovoConfig;
        reply = buildConfigMsg(session.ip, jaTeveIp);
      }

      // Não conseguiu pressionar P a tempo
      else if (["nao consegui","não consegui","passou rapido","passou rápido","perdi","nao deu tempo","nao apareceu pontinho","não apareceu"].some(w => msg.includes(w))) {
        reply = (
          `Não tem problema! Tenta assim:\n\n` +
          `1️⃣ *Confere se o teclado está plugado* no microterminal antes de ligar\n` +
          `   _(sem teclado conectado, o P não funciona)_\n` +
          `2️⃣ Desligue o microterminal\n` +
          `3️⃣ *Antes de ligar*, posicione o dedo já na tecla *P*\n` +
          `4️⃣ Ligue e pressione o *P imediatamente* assim que ligar\n\n` +
          `A janela dos pontinhos é bem rápida — com o dedo já posicionado fica muito mais fácil 😊`
        );
      }

      else if (await isAffirmative(msg)) {
        session.step = "confirm_done";
        reply = `Boa 👍\n\nSó pra confirmar: está funcionando normalmente agora? 😊`;
      }

      else if (await isNegative(msg)) {
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
      }

      else if (await isNeutral(msg)) {
        reply = session.ip
          ? `Conseguiu conectar ou ainda não? 😊`
          : `Me manda o IP pra gente continuar 😊`;
      }

      else {
        const errorTypeAmbig = detectErrorType(msg);
        if (errorTypeAmbig === "network") {
          session.attempts = Math.min((session.attempts || 0) + 1, 99);
          reply = `Parece problema de rede 🌐\n\nO computador não está alcançando o IP *${session.ip || "configurado"}*.\n\nPode ser:\n- IP digitado errado no microterminal\n- Cabo solto ou com defeito\n- WiFi e cabo: certifica que usou o IP do *cabo*\n\nTira o cabo, coloca de novo firme, e tenta de novo 👍`;
        } else if (errorTypeAmbig === "ip") {
          reply = `Confere o IP 👀\n\nTenta digitar novamente *${session.ip || "o IP correto"}* e salvar (H → 1) 👍`;
        } else {
          const respostaRAGConfig = await responderComRAG(message, session.name);
          if (respostaRAGConfig) {
            reply = `${respostaRAGConfig}\n\n---\nIsso ajudou ou ainda está com problema? 😊`;
          } else {
            reply = `Pode me contar melhor o que está aparecendo? 😊\n\nPor exemplo:\n- Não conseguiu pressionar P a tempo?\n- Salvou mas não conectou?\n- Aparece alguma mensagem de erro?`;
          }
        }
      }
    }

    // ==========================
    // STEP: ESCALATION
    // ==========================
    else if (session.step === "escalation") {
      // Palavras que descrevem o estado do problema — não são resposta sim/não ao suporte
      // ex: "continua igual", "mesma coisa" → tratar como neutro, pedir sim/não de novo
      const descrevePersistencia = [
        "continua igual","mesma coisa","mesmo problema","continua o mesmo",
        "ainda nao resolveu","ainda nao funcionou","ainda com problema",
        "nao mudou nada","igual ainda",
      ].some(w => msg.includes(w));

      if (!descrevePersistencia && await isAffirmative(msg)) {
        deleteSession(session_id);
        const contatoMsg = isBusinessHours()
          ? `Em breve um técnico entra em contato aqui pelo WhatsApp 🛠️`
          : `Como estamos fora do horário agora, um técnico entra em contato assim que estivermos ON (seg-sex 8h-18h) 🛠️`;
        return res.send(`Feito! ✅\n\nVocê está na fila de suporte da ThR.\n\n${contatoMsg}\n\nQualquer dúvida, é só chamar!`);
      } else if (!descrevePersistencia && await isNegative(msg)) {
        session.step = "config_terminal";
        session.attempts = 1; // dá mais 2 tentativas antes de escalar de novo
        reply = `Tudo bem! Vamos continuar tentando 💪\n\nMe conta o que está aparecendo no microterminal agora?`;
      } else {
        reply = `Para chamar o suporte, responde *sim*.\nSe quiser continuar tentando, responde *não* 😊`;
      }
    }

    // ==========================
    // STEP: CONFIRM_DONE
    // ==========================
    else if (session.step === "confirm_done") {
      if (await isAffirmative(msg)) {
        session.step = "final";
        reply = pick(
          `Boa ${session.name}! 🎉\n\nFuncionou 😄\n\nQualquer coisa, chama 👍`,
          `Boa ${session.name}! 🙌\n\nFico feliz que deu certo!\n\nEstou aqui se precisar, é só chamar 😊`,
          `Boa ${session.name}! 🎊\n\nJá está tudo funcionando!\n\nQualquer coisa, é só chamar 😄`,
        );
      } else if (await isNegative(msg)) {
        session.step = "config_terminal";
        reply = `Beleza, então vamos continuar 👇\n\nO que ainda está acontecendo?`;
      } else {
        reply = `Está funcionando agora ou ainda não?`;
      }
    }

    // ==========================
    // STEP: FINAL
    // ==========================
    else if (session.step === "final") {
      deleteSession(session_id);
      return res.send(pick(
        `Por nada 😊\n\nSe precisar, é só chamar! 👍`,
        `Por nada! 😄\n\nQualquer coisa, é só chamar 👍`,
        `Por nada, fico feliz em ter ajudado! 😊\n\nEstou sempre por aqui, é só chamar 👍`,
      ));
    }

    else if (await isNeutral(msg)) {
      deleteSession(session_id);
      return res.send(`Tudo certo 👍\n\nSe precisar depois, é só chamar 😊`);
    }

    else {
      return res.send(`Se precisar de algo, estou por aqui 👍`);
    }

    session.lastInteraction = Date.now();
    saveSession(session_id, session);
    return res.send(reply);

  } catch (err) {
    console.error("Erro no chat:", err);
    return res.status(500).send("Erro interno do servidor 😕");
  }
});

export default router;