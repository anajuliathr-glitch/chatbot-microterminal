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
  return ["nao","não","erro","falhou","nao deu","não deu","deu errado","nada ainda","ainda nao","ainda não","continua","mesma coisa"].some(w => msg.includes(w));
}

function isManualAffirmative(msg) {
  if (isManualNegative(msg)) return false;
  const exatos = ["sim","simm","ss","s","aham","uhum","fiz"];
  if (exatos.some(w => msg.trim() === w)) return true;
  if (msg.trim() === "foi") return true;
  const parciais = [
    "agora foi","agora deu","deu certo","foi sim",
    "funcionou","resolveu","resolvido","consegui","conectou",
    "ta funcionando","tá funcionando","ta ok","tá ok",
    "tudo certo","tudo ok","ja foi","já foi",
    "funcionando agora","conectado","deu sim","sim deu",
    "deu boa","foi isso","agora sim","ahhh agora","ahh agora",
    "agora conectou","ja conectou","já conectou","respondeu",
  ];
  return parciais.some(w => msg.includes(w));
}

function isManualThanks(msg) {
  return ["obrigado","obrigada","obg","valeu","agradecido","agradecida","tchau","tchauu"].some(w => msg.includes(w));
}

function isManualNeutral(msg) {
  return ["ok","okk","okey","blz","beleza","entendi","ata","ah ta","ah tá","hmm"].some(w => msg.includes(w));
}

function isManualNoProblem(msg) {
  return [
    "nada","nada nao","nada não","de boa","tranquilo",
    "so testando","só testando","testando",
    "ja resolvi","já resolvi","resolvido",
    "ta ok","tá ok","tudo certo","tudo ok",
    "ta resolvido","tá resolvido","ja ta","já tá",
    "ja foi","já foi","consegui resolver",
  ].some(w => msg.includes(w));
}

function forgotToSave(msg) {
  return ["nao salvei","não salvei","esqueci"].some(w => msg.includes(w));
}

function looksLikeIP(ip) {
  const clean = ip.trim();
  const regex = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  return regex.test(clean);
}

function detectErrorType(msg) {
  const networkWords = ["tempo esgotado","esgotado","falha","falhou","sem resposta","nao responde","nao respondeu","rede","cabo","conexao","conexão"];
  const ipWords = ["inacessivel","inacessível","ip errado","host inacessivel","destino inacessivel"];
  if (networkWords.some(w => msg.includes(w))) return "network";
  if (ipWords.some(w => msg.includes(w))) return "ip";
  return null;
}

// 🔥 DETECTA INTENÇÃO DE ENVIAR FOTO/PRINT
function wantsToSendPhoto(msg) {
  return [
    "vou te mandar uma foto","vou mandar uma foto",
    "vou te mandar um print","vou mandar um print",
    "vou te mandar uma imagem","vou mandar uma imagem",
    "posso mandar foto","posso mandar print",
    "vou tirar um print","vou tirar uma foto",
    "mando foto","mando print","mando imagem",
    "te mando foto","te mando print",
    "vou te mostrar","olha so","olha só",
    "deixa eu te mostrar","vou printar",
    "olha essa foto","olha essa imagem","olha esse print",
  ].some(w => msg.includes(w));
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

    // Agradecimento / encerramento
    if (await isThanks(msg)) {
      deleteSession(session_id);
      return res.send(`Por nada 😊\n\nSe precisar, é só chamar! 👍`);
    }

    if (msg === "reset") {
      deleteSession(session_id);
      return res.send("Memória resetada 🔄");
    }

    let session = getSession(session_id);
    const now = Date.now();

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
      session.name = message.trim().split(" ")[0];
      session.step = "ask_problem";
      reply = `Prazer, ${session.name}! 😊\n\nPode me dizer o que aconteceu?`;
    }

    // ==========================
    // STEP: ASK_PROBLEM
    // ==========================
    else if (session.step === "ask_problem") {

      // Nenhum problema
      if (await isNoProblem(msg)) {
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

      // Já mandou o IP direto
      if (looksLikeIP(msg)) {
        session.ip = msg.trim();
        session.attempts = 0;
        session.step = "config_terminal";
        reply = `Perfeito 👍\n\nAgora no microterminal:\n\n1. Pressione 1\n2. Digite o IP: ${session.ip}\n3. Aperte Enter\n4. Aperte H para salvar\n\nMe avisa se deu certo 😊`;
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

      if (looksLikeIP(msg)) {
        session.ip = msg.trim();
        session.attempts = 0;
        session.step = "config_terminal";
        reply = `Perfeito 👍\n\nAgora no microterminal:\n\n1. Pressione 1\n2. Digite o IP: ${session.ip}\n3. Aperte Enter\n4. Aperte H para salvar\n\nMe avisa se deu certo 😊`;
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

      // Quer mandar foto no meio do fluxo
      else if (wantsToSendPhoto(msg)) {
        reply = `Pelo chat de texto não consigo receber imagens 😊\n\nMas pode descrever o que você está vendo na tela que eu te ajudo a encontrar o IP 👍`;
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

      if (forgotToSave(msg)) {
        reply = `Boa 👍\n\nDepois do IP, aperta H pra salvar 😊`;
      }

      else if (wantsToSendPhoto(msg)) {
        reply = `Pelo chat de texto não consigo receber imagens 😊\n\nPode descrever o que aparece na tela do microterminal? Por exemplo, tem alguma mensagem de erro? 👍`;
      }

      else if (await isAffirmative(msg)) {
        session.step = "confirm_done";
        reply = `Boa 👍\n\nSó pra confirmar: está funcionando normalmente agora? 😊`;
      }

      else if (await isNegative(msg)) {
        session.attempts++;

        if (errorType === "ip") {
          reply = `Confere o IP 👀\n\nPode estar digitado errado 👍`;
        } else if (errorType === "network") {
          reply = `Pode ser rede 🌐\n\nConfere o cabo ou conexão 👍`;
        } else if (session.attempts === 1) {
          reply = `Vamos checar tudo passo a passo 👇\n\n🔹 IP (${session.ip})\nConfere se você digitou exatamente esse IP no microterminal.\nSe errou, digita novamente e salva com H 👍\n\n🔹 Cabo 🔌\nTira o cabo de rede do microterminal\nColoca de novo até sentir firme\nSe tiver outro cabo, testa também\n\n🔹 Rede 🌐\nNo computador:\n1. Aperta Windows 🪟\n2. Digita: cmd\n3. Digita: ping ${session.ip}\nSe aparecer "tempo esgotado" ou "falha", pode ser problema de rede\n\n🔹 Reiniciar 🔄\nDesliga o microterminal\nLiga novamente\nE tenta conectar de novo\n\nMe fala o que aconteceu depois disso 😊`;
        } else if (session.attempts === 2) {
          reply = `Ainda não foi 😕 vamos revisar com calma 👇\n\nVocê conseguiu rodar o ping? (ping ${session.ip})\nO que apareceu na tela?\n\nSe apareceu "tempo esgotado" → problema de rede ou IP errado\nSe apareceu resposta → o problema pode ser no microterminal mesmo\n\nMe conta o que apareceu 👍`;
        } else {
          reply = `Beleza, vamos aprofundar 👇\n\nNesse ponto pode ser algo mais específico do equipamento.\nTenta isso:\n\n1. Desliga o microterminal da tomada\n2. Espera 30 segundos\n3. Liga de novo\n4. Tenta configurar o IP novamente (pressiona 1, digita ${session.ip || "o IP"}, Enter, H)\n\nSe ainda não funcionar, pode ser necessário acionar o suporte técnico presencial 🛠️\n\nTentou isso? 😊`;
        }
      }

      else if (await isNeutral(msg)) {
        reply = session.ip
          ? `Beleza 👍\n\nConseguiu conectar ou ainda não?`
          : `Beleza 👍\n\nMe manda o IP pra gente continuar 😊`;
      }

      else {
        const errorTypeAmbig = detectErrorType(msg);
        if (errorTypeAmbig === "network") {
          session.attempts++;
          reply = `Entendi, parece problema de rede 🌐\n\nO ping mostrou "tempo esgotado", então o computador não está alcançando o IP ${session.ip || "configurado"}.\n\nPode ser:\n- IP digitado errado no microterminal\n- Cabo de rede solto ou com defeito\n- Problema na rede local\n\nTenta: desliga o cabo, coloca de novo firme, e refaz o ping 👍`;
        } else if (errorTypeAmbig === "ip") {
          reply = `Confere o IP 👀\n\nPode estar digitado errado no microterminal.\nTenta digitar novamente: ${session.ip || "o IP correto"} e salva com H 👍`;
        } else {
          const respostaRAGConfig = await responderComRAG(message, session.name);
          if (respostaRAGConfig) {
            reply = `${respostaRAGConfig}\n\n---\nIsso ajudou ou ainda está com problema? 😊`;
          } else {
            reply = `Pode me contar melhor o que está aparecendo? 😊\n\nPor exemplo:\n- Aparece alguma mensagem de erro?\n- O ping deu "tempo esgotado" ou respondeu?\n- O microterminal mostra alguma tela específica?`;
          }
        }
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