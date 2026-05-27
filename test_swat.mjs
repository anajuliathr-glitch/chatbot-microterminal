const BASE = "http://localhost:3001/chat";
let passed=0, failed=0, total=0;
const failures = [];

async function t(msg, sid, label, check) {
  const res = await fetch(BASE, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({message:msg,session_id:sid}) });
  const text = await res.text();
  total++;
  let ok = true;
  if (typeof check === "string")   ok = text.toLowerCase().includes(check.toLowerCase());
  if (typeof check === "function") ok = check(text);
  if (ok) { passed++; process.stdout.write("✅"); }
  else    { failed++; failures.push({label,msg,got:text.slice(0,120)}); process.stdout.write("❌"); }
  await new Promise(r=>setTimeout(r,350));
  return text;
}
function sid() { return "s"+Math.random().toString(36).slice(2,8); }
const has  = (...w) => t => w.every(x => t.toLowerCase().includes(x.toLowerCase()));
const any  = (...w) => t => w.some(x  => t.toLowerCase().includes(x.toLowerCase()));
const none = (...w) => t => w.every(x => !t.toLowerCase().includes(x.toLowerCase()));
const empty = t => t.trim() === "";
const nonempty = t => t.trim().length > 5;

// ══════════════════════════════════════════════════════
console.log("\n📦 BLOCO A — Abertura e nome");
// ══════════════════════════════════════════════════════
let s=sid(); await t("oi",s,"A01","qual seu nome");
             await t("bom dia",s,"A02 saudação em ask_name","qual");
             await t("Ana",s,"A03 nome normal","prazer");

s=sid(); await t("oi",s,"A04");
         await t("ANA BEATRIZ",s,"A05 CAPS","Ana");

s=sid(); await t("oi",s,"A06");
         await t("oi",s,"A07 saudação no lugar do nome","qual");
         await t("Carlos",s,"A08 nome depois","prazer");

s=sid(); await t("oi",s,"A09");
         await t("só testando",s,"A10 só testando no ask_name", any("tudo certo","tudo bem","chamar"));

s=sid(); await t("oi",s,"A11");
         await t("já resolvi",s,"A12 já resolvi no ask_name", any("tudo certo","tudo bem","chamar"));

s=sid(); await t("oi",s,"A13");
         await t("de boa",s,"A14 de boa no ask_name", any("tudo certo","tudo bem","chamar"));

s=sid(); await t("oi",s,"A15");
         await t("   ",s,"A16 espaços como nome", nonempty);

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO B — Detecção de problema");
// ══════════════════════════════════════════════════════
s=sid(); await t("oi",s,"B01"); await t("Maria",s,"B02");
         await t("o microterminau desconetou",s,"B03 typos","ip");

s=sid(); await t("oi",s,"B04"); await t("Joao",s,"B05");
         await t("mictroterminal nao liga",s,"B06 mictro","ip");

s=sid(); await t("oi",s,"B07"); await t("Pedro",s,"B08");
         await t("terminal quebrou",s,"B09 problema genérico","ip");

s=sid(); await t("oi",s,"B10"); await t("Luisa",s,"B11");
         await t("nao consigo conectar o micro terminal",s,"B12 micro terminal espaço","ip");

s=sid(); await t("oi",s,"B13"); await t("Rafa",s,"B14");
         await t("TERMINAL NAO FUNCIONA CARA",s,"B15 caps lock","ip");

s=sid(); await t("oi",s,"B16"); await t("Bia",s,"B17");
         await t("ta lento",s,"B18 lento","ip");

s=sid(); await t("oi",s,"B19"); await t("Leo",s,"B20");
         await t("bugou tudo aqui",s,"B21 bugou","ip");

s=sid(); await t("oi",s,"B22"); await t("Gabi",s,"B23");
         await t("só emojis",s,"B24 emojis", none("ip"));

s=sid(); await t("oi",s,"B25"); await t("Cris",s,"B26");
         await t("?",s,"B27 ponto de interrogação", nonempty);
         await t("o terminal caiu",s,"B28 problema depois","ip");

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO C — IP em formatos variados");
// ══════════════════════════════════════════════════════
s=sid(); await t("oi",s,"C01"); await t("Fer",s,"C02");
         await t("192.168.1.1",s,"C03 IP puro no ask_problem","192.168.1.1");

s=sid(); await t("oi",s,"C04"); await t("Rob",s,"C05");
         await t("o ip é 10.0.0.50",s,"C06 IP embutido ask_problem","10.0.0.50");

s=sid(); await t("oi",s,"C07"); await t("Tia",s,"C08");
         await t("terminal caiu",s,"C09"); await t("172.16.99.1 é meu ip",s,"C10 IP antes de texto","172.16.99.1");

s=sid(); await t("oi",s,"C11"); await t("Dan",s,"C12");
         await t("nao conecta",s,"C13"); await t("nao sei",s,"C14");
         await t("192 . 168 . 1 . 5",s,"C15 IP com espaços — NÃO captura", none("anotei"));
         await t("192.168.1.5",s,"C16 IP correto","anotei");

s=sid(); await t("oi",s,"C17"); await t("Nil",s,"C18");
         await t("problema na rede",s,"C19");
         await t("meu ip é 10.10.10.10 pode ajudar?",s,"C20 IP com texto","10.10.10.10");

s=sid(); await t("oi",s,"C21"); await t("Sam",s,"C22");
         await t("desconectou",s,"C23"); await t("sei sim",s,"C24");
         await t("meu ip é 172.20.1.100",s,"C25 IP no teach_ip","172.20.1.100");

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO D — Fluxo completo sucesso");
// ══════════════════════════════════════════════════════
s=sid();
await t("oi",s,"D01"); await t("Sofia",s,"D02");
await t("terminal nao conecta",s,"D03");
await t("sim, tenho o ip",s,"D04");
await t("192.168.0.200",s,"D05","anotei");
await t("deu certo",s,"D06","confirmar");
await t("sim",s,"D07","boa sofia");
await t("valeu",s,"D08","nada");

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO E — Fluxo com dificuldades e P");
// ══════════════════════════════════════════════════════
s=sid();
await t("oi",s,"E01"); await t("Bruno",s,"E02");
await t("terminal travou",s,"E03");
await t("nao sei o ip",s,"E04");
await t("nao achei",s,"E05 tentativa 1");
await t("ainda nao",s,"E06 tentativa 2");
await t("192.168.5.5",s,"E07 IP na 3a tentativa","anotei");
await t("nao consegui pressionar o P",s,"E08","teclado");
await t("agora apareceu o menu",s,"E09","confirmar");
await t("sim",s,"E10"); await t("obrigado",s,"E11","nada");

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO F — Desistência e escalação");
// ══════════════════════════════════════════════════════
s=sid();
await t("oi",s,"F01"); await t("Fabi",s,"F02");
await t("terminal caiu",s,"F03"); await t("nao sei o ip",s,"F04");
await t("nao quero mais",s,"F05 desiste teach_ip","suporte");
await t("sim",s,"F06 aceita suporte","fila");

s=sid();
await t("oi",s,"F07"); await t("Nico",s,"F08");
await t("nao conecta",s,"F09");
await t("quero falar com tecnico",s,"F10 pede técnico no ask_ip","suporte");
await t("nao",s,"F11 recusa — continua","continuar");
await t("192.168.1.1",s,"F12","anotei");
await t("nao funcionou",s,"F13");
await t("nao adiantou nada",s,"F14");
await t("continua igual",s,"F15 → escalação","suporte");
await t("nao",s,"F16 recusa de novo","continuar");
await t("deu certo agora",s,"F17","confirmar");
await t("sim",s,"F18"); await t("tchau",s,"F19","nada");

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO G — Afirmativos extremos");
// ══════════════════════════════════════════════════════
const afirmativos = ["ss","aham","uhum","foi sim","agora deu","deu boa","era isso","agora sim","ja deu","foi la","era so isso","agora conectou","ja conectou"];
for (const af of afirmativos) {
  const ss=sid();
  await t("oi",ss,"Gx"); await t("X",ss,"Gx"); await t("terminal caiu",ss,"Gx"); await t("10.0.0.1",ss,"Gx");
  await t(af,ss,`G afirm: "${af}"`, any("confirmar","boa","funcionou"));
}

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO H — Negativos extremos");
// ══════════════════════════════════════════════════════
const negativos = ["nenhum deu certo","nada funcionou","nao adiantou","fiz tudo e nao resolveu","continua igual","mesma coisa","tentei tudo"];
s=sid();
await t("oi",s,"H01"); await t("Kim",s,"H02");
await t("terminal caiu",s,"H03"); await t("10.0.0.1",s,"H04");
for (const neg of negativos) {
  await t(neg,s,`H neg: "${neg}"`, none("boa 👍"));
}

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO I — Typos pesados");
// ══════════════════════════════════════════════════════
const typos = [
  "microterminau","mictroterminal","micro terminal",
  "funcionau","conectau","terminau","travau","salvau",
  "precionei","cofigurar","porblema","poblema",
  "naum","soom","nop","okk",
];
for (const typo of typos) {
  const ss=sid();
  await t("oi",ss,"Ix"); await t("T",ss,"Ix");
  await t(`o ${typo} nao liga`,ss,`I typo: "${typo}"`, nonempty);
}

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO J — Casos especiais");
// ══════════════════════════════════════════════════════
// Reset mid-conversa
s=sid();
await t("oi",s,"J01"); await t("Reset",s,"J02");
await t("terminal caiu",s,"J03"); await t("reset",s,"J04 reset","resetada");
await t("oi",s,"J05 recomeça","qual seu nome");

// Agradecimento sem sessão
await t("obrigado",sid(),"J06 obrigado sem sessão",empty);
await t("valeu",sid(),"J07 valeu sem sessão",empty);
await t("tchau",sid(),"J08 tchau sem sessão",empty);

// Mensagem gigante
s=sid(); await t("oi",s,"J09"); await t("Mega",s,"J10");
await t("o terminal ".repeat(40)+"nao conecta",s,"J11 msg enorme", nonempty);

// Números não-IP
s=sid(); await t("oi",s,"J12"); await t("Num",s,"J13");
await t("99999",s,"J14 números não-IP", none("anotei"));

// IP novo durante config
s=sid();
await t("oi",s,"J15"); await t("Fix",s,"J16");
await t("terminal caiu",s,"J17"); await t("192.168.1.1",s,"J18");
await t("nao conectou",s,"J19");
await t("acho que o ip certo é 192.168.1.200",s,"J20 IP novo na config","192.168.1.200");

// Suporte direto no ask_problem
s=sid(); await t("oi",s,"J21"); await t("Dir",s,"J22");
await t("quero suporte humano agora",s,"J23 suporte no ask_problem","suporte");

// Resolve+agradece junto
s=sid(); await t("oi",s,"J24"); await t("Combo",s,"J25");
await t("ja resolvi obrigada",s,"J26 resolv+obrigada","nada");

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO K — Foto e áudio em todos os steps");
// ══════════════════════════════════════════════════════
s=sid(); await t("oi",s,"K01"); await t("posso mandar foto?",s,"K02 foto no ask_name","receber");
s=sid(); await t("oi",s,"K03"); await t("Foto",s,"K04"); await t("foto da tela",s,"K05 foto ask_problem","receber");
s=sid(); await t("oi",s,"K06"); await t("Aud",s,"K07"); await t("caiu",s,"K08"); await t("quero mandar audio",s,"K09 audio ask_ip","digitar");
s=sid(); await t("oi",s,"K10"); await t("Aud2",s,"K11"); await t("caiu",s,"K12"); await t("192.168.1.1",s,"K13"); await t("vou te mandar um audio",s,"K14 audio config","digitar");
s=sid(); await t("oi",s,"K15"); await t("Print",s,"K16"); await t("nao conecta",s,"K17"); await t("nao sei",s,"K18"); await t("posso mandar print?",s,"K19 print teach_ip","receber");

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO L — Misto e estresse");
// ══════════════════════════════════════════════════════
// Múltiplos IPs na mensagem — deve pegar o primeiro
s=sid(); await t("oi",s,"L01"); await t("Multi",s,"L02");
await t("terminal caiu",s,"L03");
await t("tenho dois ips: 192.168.1.1 e 10.0.0.5",s,"L04 dois IPs — pega 1o","192.168.1.1");

// Sim logo no ask_problem (sem problema ainda)
s=sid(); await t("oi",s,"L05"); await t("Afirm",s,"L06");
await t("sim",s,"L07 sim no ask_problem — pede mais detalhes", nonempty);

// Não logo no ask_problem
s=sid(); await t("oi",s,"L08"); await t("Neg",s,"L09");
await t("nao",s,"L10 nao no ask_problem", nonempty);

// Sessão completa em português bem escrito
s=sid();
await t("oi",s,"L11"); await t("Fernanda Lima",s,"L12 nome composto","Fernanda");
await t("Bom dia! O microterminal da minha loja parou de funcionar esta manhã. Não está conectando na rede.",s,"L13 problema formal","ip");
await t("Sim, tenho o IP do servidor aqui.",s,"L14");
await t("O endereço é 192.168.15.100",s,"L15","192.168.15.100");
await t("Salvei e sair, agora o terminal está conectando normalmente!",s,"L16","confirmar");
await t("Sim, está funcionando perfeitamente!",s,"L17","boa");
await t("Muito obrigada pela ajuda!",s,"L18","nada");

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO M — Validação de nome e edge cases extras");
// ══════════════════════════════════════════════════════

// Número como nome — deve pedir nome de novo
s=sid(); await t("oi",s,"M01");
await t("123",s,"M02 número como nome", any("nome","chamar","como"));

// "meu nome é X" — deve extrair X
s=sid(); await t("oi",s,"M03");
await t("meu nome é Maria",s,"M04 meu nome é X","Maria");

// "me chamo X" — deve extrair X
s=sid(); await t("oi",s,"M05");
await t("me chamo Bruno",s,"M06 me chamo X","Bruno");

// Nome com número misturado — extrai parte letra
s=sid(); await t("oi",s,"M07");
await t("Ana123",s,"M08 nome com número","Ana");

// Mensagem com quebra de linha no meio
s=sid(); await t("oi",s,"M09"); await t("Kika",s,"M10");
await t("terminal\ncaiu\naqui",s,"M11 quebra de linha no problema", any("ip","conectar","resolver"));

// IP dentro de frase longa com quebra de linha
s=sid(); await t("oi",s,"M12"); await t("Duda",s,"M13");
await t("terminal caiu",s,"M14");
await t("o ip é\n192.168.1.99\ntá aqui",s,"M15 IP com quebra de linha","192.168.1.99");

// Suporte pedido com palavras diferentes
s=sid(); await t("oi",s,"M16"); await t("Zeca",s,"M17");
await t("preciso de um atendente humano",s,"M18 atendente no ask_problem","suporte");

// Cliente manda "eu sou Ana" — deve pegar Ana
s=sid(); await t("oi",s,"M19");
await t("eu sou Ana",s,"M20 eu sou X","Ana");

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO N — Typos reais do WhatsApp (vistos em produção)");
// ══════════════════════════════════════════════════════

// "Nao cobeta" → não conecta
s=sid(); await t("oi",s,"N01"); await t("Ana",s,"N02");
await t("nao cobeta",s,"N03 cobeta=conecta", any("ip","conecta","verificar"));

// "Desconertou" → desconectou
s=sid(); await t("oi",s,"N04"); await t("Bia",s,"N05");
await t("desconertou",s,"N06 desconertou", any("ip","conecta","verificar"));

// "Naoconeta" (tudo junto sem espaço)
s=sid(); await t("oi",s,"N07"); await t("Cris",s,"N08");
await t("naoconeta",s,"N09 naoconeta junto", any("ip","conecta","verificar"));

// "Na9" → não
s=sid(); await t("oi",s,"N10"); await t("Dani",s,"N11");
await t("nao conecta",s,"N12");
await t("nao sei o ip",s,"N13");
await t("nao achei",s,"N14");
await t("Na9",s,"N15 Na9=nao", any("tenta","cmd","windows","passo"));

// "Nao conseguu" → não consegui
s=sid(); await t("oi",s,"N16"); await t("Fer",s,"N17");
await t("nao conecta",s,"N18");
await t("nao sei",s,"N19");
await t("nao conseguu",s,"N20 conseguu=consegui", any("tenta","dificil","suporte"));

// "Disconectou" → desconectou
s=sid(); await t("oi",s,"N21"); await t("Gabi",s,"N22");
await t("disconectou",s,"N23 disconectou", any("ip","conecta","verificar"));

// "Nao deu certo" no teach_ip
s=sid(); await t("oi",s,"N24"); await t("Helo",s,"N25");
await t("nao conecta",s,"N26");
await t("nao sei",s,"N27");
await t("nao deu certo",s,"N28 nao deu certo no teach_ip", any("tenta","passo","cmd"));

// "Ele nao conecta" → vai direto pro IP
s=sid(); await t("oi",s,"N29"); await t("Iris",s,"N30");
await t("ele nao conecta",s,"N31 ele nao conecta", any("ip","conecta"));

// "Nao carrega" → problema de conexão
s=sid(); await t("oi",s,"N32"); await t("Juli",s,"N33");
await t("nao carrega",s,"N34 nao carrega", any("ip","conecta","verificar"));

// "Oikl" não deve ser aceito como nome
s=sid(); await t("oi",s,"N35");
await t("Oikl",s,"N36 oikl nao é nome", any("nome","chamar"));

// "Achei o ip" na escalation retoma o fluxo
s=sid(); await t("oi",s,"N37"); await t("Kika",s,"N38");
await t("nao conecta",s,"N39");
await t("nao sei",s,"N40");
await t("nao achei",s,"N41");
await t("nao consegui de jeito nenhum",s,"N42");
await t("nao",s,"N43 recusa suporte");
await t("achei o ip",s,"N44 achei o ip na escalation", any("manda","192","ip","número"));

// "Estava sim" não deve pular pra confirm_done
s=sid(); await t("oi",s,"N45"); await t("Leo",s,"N46");
await t("nao conecta",s,"N47");
await t("192.168.1.50",s,"N48");
await t("nao foi",s,"N49");
await t("estava sim",s,"N50 estava sim nao é confirmação", none("funcionando normalmente"));

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO O — Variações de problema no ask_problem");
// ══════════════════════════════════════════════════════

// "liga mas nao conecta" → deve pedir IP
s=sid(); await t("oi",s,"O01"); await t("Ale",s,"O02");
await t("liga mas nao conecta",s,"O03 liga mas nao conecta", any("ip","conecta","verificar","sabe"));

// "ficou sem internet" → deve pedir IP
s=sid(); await t("oi",s,"O04"); await t("Bru",s,"O05");
await t("ficou sem internet",s,"O06 ficou sem internet", any("ip","conecta","verificar","sabe"));

// "preciso configurar do zero" → deve pedir IP
s=sid(); await t("oi",s,"O07"); await t("Car",s,"O08");
await t("preciso configurar do zero",s,"O09 configurar do zero", any("ip","configurar","sabe","verificar"));

// "como configuro o terminal" → deve responder de forma útil (não "não entendi")
s=sid(); await t("oi",s,"O10"); await t("Dan",s,"O11");
await t("como configuro o terminal",s,"O12 como configuro", none("nao entendi"));

// "aparece erro na tela" → deve responder de forma útil (não "não entendi")
s=sid(); await t("oi",s,"O13"); await t("Eva",s,"O14");
await t("aparece erro na tela",s,"O15 erro na tela", none("nao entendi"));

// "tenho o ip aqui, posso passar?" → deve dizer sim, manda
s=sid(); await t("oi",s,"O16"); await t("Fab",s,"O17");
await t("nao conecta",s,"O18");
await t("tenho o ip aqui, posso passar?",s,"O19 tenho ip posso passar", any("manda","pode","sim","claro","otimo","ótimo"));

// "reiniciou mas nao conecta" → deve pedir IP
s=sid(); await t("oi",s,"O20"); await t("Gil",s,"O21");
await t("reiniciou mas nao conecta",s,"O22 reiniciou nao conecta", any("ip","conecta","verificar","sabe"));

// "funciona mas ta muito lento" → deve pedir IP (lentidão = rede)
s=sid(); await t("oi",s,"O23"); await t("Hel",s,"O24");
await t("funciona mas ta muito lento",s,"O25 muito lento", any("ip","lento","rede","verificar","sabe"));

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO P — Mensagens ambíguas/curtas em vários steps");
// ══════════════════════════════════════════════════════

// "ok" no teach_ip → deve dar alguma orientação (não em branco)
s=sid(); await t("oi",s,"P01"); await t("Ian",s,"P02");
await t("nao conecta",s,"P03");
await t("nao sei",s,"P04");
await t("ok",s,"P05 ok no teach_ip", nonempty);

// "entendi" no config_terminal → deve encorajar/aguardar
s=sid(); await t("oi",s,"P06"); await t("Jul",s,"P07");
await t("nao conecta",s,"P08");
await t("192.168.1.1",s,"P09");
await t("entendi",s,"P10 entendi no config_terminal", nonempty);

// "certo" no ask_problem → deve pedir o que está acontecendo
s=sid(); await t("oi",s,"P11"); await t("Kel",s,"P12");
await t("certo",s,"P13 certo no ask_problem", nonempty);

// "to aqui" em qualquer step → deve pedir esclarecimento
s=sid(); await t("oi",s,"P14"); await t("Leo",s,"P15");
await t("nao conecta",s,"P16");
await t("nao sei",s,"P17");
await t("to aqui",s,"P18 to aqui no teach_ip", nonempty);

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO Q — Edge cases no teach_ip");
// ══════════════════════════════════════════════════════

// "tem dois ips aqui" → deve explicar usar IPv4 do cabo
s=sid(); await t("oi",s,"Q01"); await t("Mar",s,"Q02");
await t("nao conecta",s,"Q03");
await t("nao sei",s,"Q04");
await t("tem dois ips aqui",s,"Q05 dois ips", any("cabo","ipv4","endereco","endereço","qual"));

// "apareceu varios numeros" → deve explicar usar IPv4
s=sid(); await t("oi",s,"Q06"); await t("Nat",s,"Q07");
await t("nao conecta",s,"Q08");
await t("nao sei",s,"Q09");
await t("apareceu varios numeros",s,"Q10 varios numeros", any("cabo","ipv4","endereco","endereço","qual","numero","número"));

// "nao acho o cmd" → deve dar alternativa para abrir CMD
s=sid(); await t("oi",s,"Q11"); await t("Oto",s,"Q12");
await t("nao conecta",s,"Q13");
await t("nao sei",s,"Q14");
await t("nao acho o cmd",s,"Q15 nao acho cmd", any("windows","r","win","iniciar","pesquis","menu"));

// "abriu mas esta vazio" → deve guiar o que digitar
s=sid(); await t("oi",s,"Q16"); await t("Pau",s,"Q17");
await t("nao conecta",s,"Q18");
await t("nao sei",s,"Q19");
await t("abriu mas esta vazio",s,"Q20 cmd vazio", any("ipconfig","digita","ip"));

// "apareceu mas nao tem endereco ipv4" → deve explicar onde olhar
s=sid(); await t("oi",s,"Q21"); await t("Qui",s,"Q22");
await t("nao conecta",s,"Q23");
await t("nao sei",s,"Q24");
await t("apareceu mas nao tem endereco ipv4",s,"Q25 sem ipv4", any("cabo","wifi","adapter","ethernet","rede","placa","lista","procura"));

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO R — Edge cases no config_terminal");
// ══════════════════════════════════════════════════════

// "o P nao funciona" → teclado não conectado
s=sid(); await t("oi",s,"R01"); await t("Ros",s,"R02");
await t("nao conecta",s,"R03");
await t("192.168.1.1",s,"R04");
await t("o P nao funciona",s,"R05 P nao funciona", any("teclado","conectado","plugado","antes de ligar"));

// "menu apareceu mas sumiu rapido" → não pressionou P a tempo
s=sid(); await t("oi",s,"R06"); await t("Ser",s,"R07");
await t("nao conecta",s,"R08");
await t("192.168.1.1",s,"R09");
await t("menu apareceu mas sumiu rapido",s,"R10 menu sumiu rapido", any("pontinho","p","tecla","rapido","rápido","antes","posicion"));

// "salvei mas voltou pra tela preta" → checar cabo/conexão
s=sid(); await t("oi",s,"R11"); await t("Tia",s,"R12");
await t("nao conecta",s,"R13");
await t("192.168.1.1",s,"R14");
await t("salvei mas voltou pra tela preta",s,"R15 salvei mas tela preta", any("cabo","ip","rede","confere","verifica","conectou"));

// "nao apareceu o menu dos pontinhos" → timing/teclado
s=sid(); await t("oi",s,"R16"); await t("Uma",s,"R17");
await t("nao conecta",s,"R18");
await t("192.168.1.1",s,"R19");
await t("nao apareceu o menu dos pontinhos",s,"R20 sem menu pontinhos", any("teclado","p","tecla","antes","ligar","pontinho"));

// "quanto tempo demora" → dar estimativa realista
s=sid(); await t("oi",s,"R21"); await t("Val",s,"R22");
await t("nao conecta",s,"R23");
await t("192.168.1.1",s,"R24");
await t("quanto tempo demora",s,"R25 quanto tempo demora", any("segundo","minuto","rapido","rápido","pouco","instante","automat"));

// "pode me ligar" → oferecer escalation
s=sid(); await t("oi",s,"R26"); await t("Wil",s,"R27");
await t("nao conecta",s,"R28");
await t("192.168.1.1",s,"R29");
await t("pode me ligar",s,"R30 pode me ligar", any("suporte","tecnico","técnico","fila","contato","ligar","whatsapp"));

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO S — Mid-config: estados no meio da configuração");
// ══════════════════════════════════════════════════════

// "entrei no menu" no config_terminal — NÃO deve pular para confirm_done
s=sid(); await t("oi",s,"S01"); await t("Ana",s,"S02");
await t("nao conecta",s,"S03");
await t("192.168.1.50",s,"S04");
await t("entrei no menu",s,"S05 entrei no menu nao é confirm", any("1","pressione","digita","ip","salvar","h"));

// "apareceu o menu de configuracao" — deve dar passos 4-8
s=sid(); await t("oi",s,"S06"); await t("Bru",s,"S07");
await t("nao conecta",s,"S08");
await t("192.168.1.50",s,"S09");
await t("apareceu o menu de configuracao",s,"S10 apareceu menu config", any("1","pressione","digita","ip","salvar","h"));

// "consegui entrar no menu" — NÃO deve pular para confirm_done
s=sid(); await t("oi",s,"S11"); await t("Car",s,"S12");
await t("nao conecta",s,"S13");
await t("192.168.1.50",s,"S14");
await t("consegui entrar no menu",s,"S15 consegui menu nao é confirm", any("1","pressione","digita","ip","salvar","h"));

// "ta pedindo pra digitar o ip" — deve dar instrução para digitar
s=sid(); await t("oi",s,"S16"); await t("Dan",s,"S17");
await t("nao conecta",s,"S18");
await t("192.168.1.50",s,"S19");
await t("ta pedindo pra digitar o ip",s,"S20 pedindo digitar ip", any("192.168.1.50","ip","digita","enter"));

// "errei o ip la dentro" — deve dar instrução para refazer
s=sid(); await t("oi",s,"S21"); await t("Eva",s,"S22");
await t("nao conecta",s,"S23");
await t("192.168.1.50",s,"S24");
await t("errei o ip la dentro",s,"S25 errei o ip", any("192.168.1.50","refaz","refazer","digita","pressione","1","menu"));

// "entrei mas nao sei o que fazer" — deve dar passos 4-8
s=sid(); await t("oi",s,"S26"); await t("Fab",s,"S27");
await t("nao conecta",s,"S28");
await t("192.168.1.50",s,"S29");
await t("entrei no menu mas nao sei o que fazer",s,"S30 entrei sem saber", any("1","pressione","digita","ip","salvar","h"));

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO T — IPs especiais e edge cases no teach_ip");
// ══════════════════════════════════════════════════════

// "169.254.1.1" (APIPA) — deve avisar que é IP especial
s=sid(); await t("oi",s,"T01"); await t("Gil",s,"T02");
await t("nao conecta",s,"T03");
await t("nao sei",s,"T04");
await t("169.254.1.1",s,"T05 APIPA invalido", any("especial","apipa","nao funciona","não funciona","192","ipv4","servidor"));

// "127.0.0.1" (loopback) — deve avisar que é IP especial
s=sid(); await t("oi",s,"T06"); await t("Hel",s,"T07");
await t("nao conecta",s,"T08");
await t("nao sei",s,"T09");
await t("127.0.0.1",s,"T10 loopback invalido", any("especial","nao funciona","não funciona","192","ipv4","servidor"));

// "como acho o ip no celular" — deve redirecionar para o computador
s=sid(); await t("oi",s,"T11"); await t("Ian",s,"T12");
await t("nao conecta",s,"T13");
await t("nao sei",s,"T14");
await t("como acho o ip no celular",s,"T15 ip no celular", any("computador","servidor","cmd","windows","pc"));

// "apareceu mas nao tem endereco ipv4 so tem ipv6" — orientar
s=sid(); await t("oi",s,"T16"); await t("Jul",s,"T17");
await t("nao conecta",s,"T18");
await t("nao sei",s,"T19");
await t("apareceu mas nao tem endereco ipv4 so tem ipv6",s,"T20 sem ipv4 so ipv6", any("cabo","wifi","ethernet","adapter","placa","local","rede","lista"));

// "abriu cmd mas nao entendi o que apareceu" — orientar a procurar IPv4
s=sid(); await t("oi",s,"T21"); await t("Kel",s,"T22");
await t("nao conecta",s,"T23");
await t("nao sei",s,"T24");
await t("abriu cmd mas nao entendi o que apareceu",s,"T25 cmd nao entendeu", any("ipv4","192","endereco","endereço","numero","número","procura"));

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO U — Cenários de produção adicionais");
// ══════════════════════════════════════════════════════

// "nao sei o que e ipv4" em teach_ip → deve explicar o que é IPv4
s=sid(); await t("oi",s,"U01"); await t("Ana",s,"U02");
await t("nao conecta",s,"U03");
await t("nao sei",s,"U04");
await t("nao sei o que e ipv4",s,"U05 o que e ipv4", any("192","formato","numero","número","ipconfig","cmd","windows"));

// "como configuro do zero" em ask_problem → deve guiar para IP
s=sid(); await t("oi",s,"U06"); await t("Bru",s,"U07");
await t("como configuro do zero",s,"U08 configuro do zero", any("ip","configurar","sabe","verificar"));

// "abriu mas so aparece ipv6" em teach_ip → orientar Ethernet
s=sid(); await t("oi",s,"U09"); await t("Car",s,"U10");
await t("nao conecta",s,"U11");
await t("nao sei",s,"U12");
await t("abriu mas so aparece ipv6",s,"U13 so ipv6", any("cabo","ethernet","local area","wifi","adaptador","rede"));

// "saiu do menu sem salvar" em config_terminal → instruções para refazer
s=sid(); await t("oi",s,"U14"); await t("Dan",s,"U15");
await t("nao conecta",s,"U16");
await t("192.168.1.50",s,"U17");
await t("saiu do menu sem salvar",s,"U18 saiu sem salvar", any("salvar","h","1","menu","novamente","refaz","deslig"));

// "digitei mas apertei cancel" em config_terminal → instruções para refazer
s=sid(); await t("oi",s,"U19"); await t("Eva",s,"U20");
await t("nao conecta",s,"U21");
await t("192.168.1.50",s,"U22");
await t("digitei mas apertei cancel",s,"U23 apertou cancel", any("salvar","h","1","menu","novamente","refaz","deslig","ip"));

// "funcionou ontem mas hoje parou" em ask_problem → pedir IP
s=sid(); await t("oi",s,"U24"); await t("Fab",s,"U25");
await t("funcionou ontem mas hoje parou",s,"U26 funcionou ontem", any("ip","conecta","verificar","sabe"));

// "ficou piscando" em ask_problem → problema de conexão → pedir IP
s=sid(); await t("oi",s,"U27"); await t("Gil",s,"U28");
await t("ficou piscando",s,"U29 ficou piscando", any("ip","conecta","verificar","sabe","rede"));

// "voltou a tela inicial" em config_terminal → orientar (mid-config ou sucesso)
s=sid(); await t("oi",s,"U30"); await t("Hel",s,"U31");
await t("nao conecta",s,"U32");
await t("192.168.1.50",s,"U33");
await t("voltou a tela inicial",s,"U34 voltou tela inicial", nonempty);

// "teclado nao estava conectado" em config_terminal → orientar reconexão
s=sid(); await t("oi",s,"U35"); await t("Ian",s,"U36");
await t("nao conecta",s,"U37");
await t("192.168.1.50",s,"U38");
await t("nao consegui pois o teclado nao estava conectado",s,"U39 teclado desconectado config", any("teclado","conectado","plugado","antes"));

// "pressionei P mas apareceu uns caracteres" em config_terminal → guia
s=sid(); await t("oi",s,"U40"); await t("Jul",s,"U41");
await t("nao conecta",s,"U42");
await t("192.168.1.50",s,"U43");
await t("pressionei P mas apareceu uns caracteres",s,"U44 caracteres apos P", nonempty);

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO V — Typos não cobertos ainda");
// ══════════════════════════════════════════════════════

// "nao conetca" → conecta → pedir IP
s=sid(); await t("oi",s,"V01"); await t("Kel",s,"V02");
await t("nao conetca",s,"V03 nao conetca", any("ip","conecta","verificar","sabe"));

// "desconetou" → desconectou → pedir IP
s=sid(); await t("oi",s,"V04"); await t("Leo",s,"V05");
await t("desconetou",s,"V06 desconetou", any("ip","conecta","verificar","sabe"));

// "nao coecta" → nao conecta → pedir IP
s=sid(); await t("oi",s,"V07"); await t("Mar",s,"V08");
await t("nao coecta",s,"V09 nao coecta", any("ip","conecta","verificar","sabe"));

// "nao funcoina" → nao funciona → pedir IP
s=sid(); await t("oi",s,"V10"); await t("Nat",s,"V11");
await t("nao funcoina",s,"V12 nao funcoina", any("ip","conecta","verificar","sabe"));

// "slvei" → salvei → no config_terminal verifica se funcionou
s=sid(); await t("oi",s,"V13"); await t("Oto",s,"V14");
await t("nao conecta",s,"V15");
await t("192.168.1.1",s,"V16");
await t("slvei",s,"V17 slvei=salvei", nonempty);

// "configuru" → configurou → checar se funcionou
s=sid(); await t("oi",s,"V18"); await t("Pau",s,"V19");
await t("nao conecta",s,"V20");
await t("192.168.1.1",s,"V21");
await t("configuru",s,"V22 configuru=configurou", nonempty);

// "econtrei o ip" → achei o IP → deve pedir para mandar
s=sid(); await t("oi",s,"V23"); await t("Qui",s,"V24");
await t("nao conecta",s,"V25");
await t("nao sei",s,"V26");
await t("econtrei o ip",s,"V27 econtrei=encontrei", any("manda","192","numero","número","ip","otimo","ótimo"));

// "nao achei o ip" → não achou → instrução passo-a-passo
s=sid(); await t("oi",s,"V28"); await t("Ros",s,"V29");
await t("nao conecta",s,"V30");
await t("nao sei",s,"V31");
await t("nao achei o ip",s,"V32 nao achei ip", any("windows","cmd","ipconfig","r","tenta","passo"));

// "ta pedido senha" → senha no menu → escalação
s=sid(); await t("oi",s,"V33"); await t("Ser",s,"V34");
await t("nao conecta",s,"V35");
await t("192.168.1.1",s,"V36");
await t("ta pedido senha",s,"V37 pedindo senha config", any("senha","suporte","tecnico","técnico","equipe","thr"));

// "pressionau P" → pressionou P → mid-config ou verificar
s=sid(); await t("oi",s,"V38"); await t("Tia",s,"V39");
await t("nao conecta",s,"V40");
await t("192.168.1.1",s,"V41");
await t("pressionau P agora apareceu o menu",s,"V42 pressionau+menu", any("1","pressione","digita","ip","salvar","h","caminho"));

// ══════════════════════════════════════════════════════
console.log("\n\n📦 BLOCO W — foi/não foi e variações reais");
// ══════════════════════════════════════════════════════

// "foi" exato em confirm_done → resolvido
s=sid(); await t("oi",s,"W01"); await t("Bia",s,"W02");
await t("nao conecta",s,"W03"); await t("10.0.0.1",s,"W04");
await t("deu certo",s,"W05"); // → confirm_done
await t("foi",s,"W06 foi exato → resolvido", any("boa","ótimo","funcionou","certo","feliz"));

// "Foiiii" com letras repetidas → resolvido
s=sid(); await t("oi",s,"W07"); await t("Car",s,"W08");
await t("nao conecta",s,"W09"); await t("10.0.0.2",s,"W10");
await t("deu certo",s,"W11");
await t("Foiiii",s,"W12 Foiiii → resolvido", any("boa","ótimo","funcionou","certo","feliz"));

// "foiii" → resolvido
s=sid(); await t("oi",s,"W13"); await t("Dan",s,"W14");
await t("nao conecta",s,"W15"); await t("10.0.0.3",s,"W16");
await t("deu certo",s,"W17");
await t("foiii",s,"W18 foiii → resolvido", any("boa","ótimo","funcionou","certo","feliz"));

// "Aahh foiii" → resolvido
s=sid(); await t("oi",s,"W19"); await t("Eva",s,"W20");
await t("nao conecta",s,"W21"); await t("10.0.0.4",s,"W22");
await t("deu certo",s,"W23");
await t("Aahh foiii",s,"W24 Aahh foiii → resolvido", any("boa","ótimo","funcionou","certo","feliz"));

// "nossa foi" → resolvido
s=sid(); await t("oi",s,"W25"); await t("Fla",s,"W26");
await t("nao conecta",s,"W27"); await t("10.0.0.5",s,"W28");
await t("deu certo",s,"W29");
await t("nossa foi",s,"W30 nossa foi → resolvido", any("boa","ótimo","funcionou","certo","feliz"));

// "nao foi" em config_terminal → continuar tentando (negativo)
s=sid(); await t("oi",s,"W31"); await t("Gil",s,"W32");
await t("nao conecta",s,"W33"); await t("10.0.0.6",s,"W34");
await t("nao foi",s,"W35 nao foi → negativo, continua", any("checar","cabo","ip","correto","confere","vamos","tentando","verifique","ainda","errado"));

// "nao foiii" → negativo
s=sid(); await t("oi",s,"W36"); await t("Hel",s,"W37");
await t("nao conecta",s,"W38"); await t("10.0.0.7",s,"W39");
await t("nao foiii",s,"W40 nao foiii → negativo", any("checar","cabo","ip","correto","confere","vamos","tentando","verifique","ainda","errado"));

// "foi errado" → negativo (não deve celebrar)
s=sid(); await t("oi",s,"W41"); await t("Isa",s,"W42");
await t("nao conecta",s,"W43"); await t("10.0.0.8",s,"W44");
await t("foi errado",s,"W45 foi errado → negativo", none("boa","ótimo","parabéns"));

// ══════════════════════════════════════════════════════
console.log("\n\n");
console.log("═".repeat(55));
const pct = Math.round(passed/total*100);
console.log(`  RESULTADO FINAL: ${passed}/${total} (${pct}%) | ${failed} falhas`);
console.log("═".repeat(55));
if (failures.length) {
  console.log("\n🔍 Falhas:");
  failures.forEach(f => {
    console.log(`\n  ❌ ${f.label}`);
    console.log(`     👤 "${f.msg}"`);
    console.log(`     🤖 "${f.got}"`);
  });
}
