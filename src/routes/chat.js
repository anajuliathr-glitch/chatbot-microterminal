import { Router } from "express";
import { log } from "../services/logger.js";
import { responderComRAG, analisarImagem, classificarIntencao } from "../services/ai.js";
import { getSession, saveSession, deleteSession } from "../services/session.js";
import config from "../config.js";

const router = Router();

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/naum/g, "nao")
    .replace(/vc/g, "você")
    .replace(/oq/g, "o que");
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
  ].some(w => msg.includes(w)) || msg.trim() === "nada" || msg.trim() === "nao" || msg.trim() === "não";
}

function isManualAffirmative(msg) {
  if (isManualNegative(msg)) return false;
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
  const intro = soPassos ? "" : `Anotei o IP: *${ip}* 👍\n\n`;
  return (
    `${intro}Agora vamos configurar o microterminal:\n\n` +
    `1️⃣ *Desligue* o microterminal e *ligue* novamente\n` +
    `2️⃣ Assim que aparecerem os *pontinhos na tela*, pressione a tecla *P* no teclado\n` +
    `   _(deixe o dedo já posicionado no P antes de ligar)_\n` +
    `3️⃣ No menu que aparecer, pressione *1* (IP do servidor)\n` +
    `4️⃣ Digite o IP: *${ip}*\n` +
    `5️⃣ Pressione *Enter*\n` +
    `6️⃣ Pressione *H*\n` +
    `7️⃣ Pressione *1* para salvar e sair\n\n` +
    `Aguarde — o terminal vai conectar automaticamente 😊\n\nMe avisa como foi!`
  );
}

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
    const { message, session_id, image } = req.body;
    if (!message || !session_id) {
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

    const msg = normalize(message);

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
      return res.send(`Por nada 😊\n\nSe precisar, é só chamar! 👍`);
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
      reply = `Oi! 😊 Sou a assistente virtual do microterminal da ThR.\n\nQual seu nome?`;
    }

    // ==========================
    // STEP: ASK_NAME
    // ==========================
    else if (session.step === "ask_name") {
      // Se mandou só saudação, pede o nome de novo
      const saudacoes = ["oi","ola","olá","hey","hi","bom dia","boa tarde","boa noite","opa","eai","e ai"];
      if (saudacoes.some(s => msg.trim() === s)) {
        reply = `Oi! 😄\n\nQual é o seu nome?`;
      } else {
        // Capitaliza o primeiro nome corretamente (ex: "ANA" → "Ana")
        const primeiroNome = message.trim().split(" ")[0];
        session.name = primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1).toLowerCase();
        session.step = "ask_problem";
        reply = `Prazer, ${session.name}! 😊\n\nPode me dizer o que aconteceu?`;
      }
    }

    // ==========================
    // STEP: ASK_PROBLEM
    // ==========================
    else if (session.step === "ask_problem") {

      // Quer mandar áudio
      if (wantsToSendAudio(msg)) {
        reply = `Aqui pelo chat não consigo receber áudios 😊\n\nMas pode digitar o que está acontecendo que te ajudo normalmente 👍`;
      }

      // Saudação ou mensagem muito curta — pede para descrever o problema
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
        } else {
          session.step = "ask_ip";
          reply = `Entendi 👍\n\nVocê sabe o IP do computador?`;
        }
      }
    }

    // ==========================
    // STEP: RAG_FOLLOWUP
    // ==========================
    else if (session.step === "rag_followup") {
      if (await isAffirmative(msg)) {
        deleteSession(session_id);
        return res.send(`Boa ${session.name}! 🎉\n\nFico feliz que ajudou 😄\n\nQualquer coisa, chama 👍`);
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

      // Já mandou o IP direto (ou junto com texto, ex: "é 192.168.1.1")
      const ipDiretoAsk = extractIP(msg);
      if (wantsToSendAudio(msg)) {
        reply = `Aqui pelo chat não consigo receber áudios 😊\n\nPode digitar o IP do computador? É um número assim: *192.168.x.x* 👍`;
        // mantém no ask_ip sem mudar o step
      } else if (ipDiretoAsk) {
        session.ip = ipDiretoAsk;
        session.attempts = 0;
        session.step = "config_terminal";
        reply = buildConfigMsg(session.ip);
      }

      // Sabe o IP mas não mandou ainda
      else if (await isAffirmative(msg) || (!await isNegative(msg) && (msg.includes("sei") || msg.includes("tenho") || msg.includes("aqui")))) {
        session.step = "teach_ip";
        reply = `Ótimo! Pode me mandar o IP 😊`;
      }

      // Não sabe
      else {
        session.step = "teach_ip";
        reply = `Sem problema! Vamos pegar o IP juntos 👇\n\n1. Aperte a tecla Windows 🪟\n2. Digite: cmd\n3. Abra\n4. Digite: ipconfig\n5. Procure por "IPv4"\n\nMe manda aqui quando achar 👍`;
      }
    }

    // ==========================
    // STEP: TEACH_IP
    // ==========================
    else if (session.step === "teach_ip") {

      const ipTeach = extractIP(msg);
      if (ipTeach) {
        session.ip = ipTeach;
        session.attempts = 0;
        session.step = "config_terminal";
        reply = buildConfigMsg(session.ip);
      }

      // Quer mandar foto — verificar ANTES do isNegative
      else if (wantsToSendPhoto(msg)) {
        reply = `Ainda não consigo receber imagens por aqui 😊\n\nMas pode descrever o que aparece na tela — tipo: "aparece um número 192.168..." — que eu te ajudo a identificar o IP 👍`;
      }

      else if (await isNegative(msg)) {
        session.attempts = (session.attempts || 0) + 1;
        if (session.attempts === 1) {
          reply = `Entendido! Vamos tentar de outro jeito 👇\n\n🔹 Clica com o botão direito no ícone do Windows (canto inferior esquerdo)\n🔹 Seleciona "Terminal" ou "PowerShell"\n🔹 Digite: ipconfig\n🔹 Procura por "Endereço IPv4" — é um número tipo 192.168.x.x\n\nO que está aparecendo na tela? Me conta 😊`;
        } else {
          const respostaRAGIp = await responderComRAG(message, session.name);
          if (respostaRAGIp) {
            reply = `${respostaRAGIp}\n\n---\nConseguiu o IP? 😊`;
          } else {
            reply = `Sem problema! Me conta o que está aparecendo na tela do computador 😊\n\nSe quiser, pode descrever o que você vê que eu te ajudo a encontrar o IP 👍`;
          }
        }
      }

      else {
        const respostaRAGIp = await responderComRAG(message, session.name);
        if (respostaRAGIp) {
          reply = `${respostaRAGIp}\n\n---\nQuando tiver o IP, me manda aqui 😊`;
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
        session.ip = ipNovoConfig;
        reply = buildConfigMsg(session.ip, true);
      }

      // Não conseguiu pressionar P a tempo
      else if (["nao consegui","não consegui","passou rapido","passou rápido","perdi","nao deu tempo","nao apareceu pontinho","não apareceu"].some(w => msg.includes(w))) {
        reply = `Não tem problema! Tenta assim:\n\n1️⃣ Desligue o microterminal\n2️⃣ *Antes de ligar*, posicione o dedo na tecla *P*\n3️⃣ Ligue e pressione o *P imediatamente* assim que ligar\n\nA janela dos pontinhos é bem rápida, por isso é importante já estar com o dedo pronto 😊`;
      }

      else if (await isAffirmative(msg)) {
        session.step = "confirm_done";
        reply = `Boa 👍\n\nSó pra confirmar: está funcionando normalmente agora? 😊`;
      }

      else if (await isNegative(msg)) {
        session.attempts++;

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
          session.attempts++;
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
      if (await isAffirmative(msg)) {
        deleteSession(session_id);
        return res.send(`Feito! ✅\n\nVocê está na fila de suporte da ThR.\n\nEm breve um técnico entra em contato aqui pelo WhatsApp 🛠️\n\nQualquer dúvida, é só chamar!`);
      } else if (await isNegative(msg)) {
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
        reply = `Boa ${session.name}! 🎉\n\nFuncionou 😄\n\nQualquer coisa, chama 👍`;
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
      return res.send(`Por nada 😊\n\nSe precisar, é só chamar! 👍`);
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