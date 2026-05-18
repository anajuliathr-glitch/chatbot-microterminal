import fs from "fs";
import mammoth from "mammoth";
import stringSimilarity from "string-similarity";

let faqContent = "";
let docContent = "";
let kbContent = "";
let faqChunks = [];
let docChunks = [];
let kbChunks = [];

function splitText(text, size = 500) {
  const arr = [];
  for (let i = 0; i < text.length; i += size) {
    arr.push(text.slice(i, i + size));
  }
  return arr;
}

function initChunks() {
  faqChunks = splitText(faqContent || "");
  docChunks = splitText(docContent || "");
  kbChunks  = splitText(kbContent  || "");
}

export async function loadDocuments() {
  try {
    faqContent = fs.readFileSync("./docs/faq_microterminal_721.html", "utf8");
  } catch {
    console.warn("⚠️ FAQ HTML não encontrado");
  }

  try {
    const result = await mammoth.extractRawText({
      path: "./docs/Microterminal.docx",
    });
    docContent = result.value;
  } catch {
    console.warn("⚠️ DOCX não encontrado");
  }

  try {
    kbContent = fs.readFileSync("./docs/base_conhecimento.txt", "utf8");
  } catch {
    console.warn("⚠️ Base de conhecimento TXT não encontrada");
  }

  initChunks();
  console.log(`📚 Documentos carregados: FAQ=${faqContent.length} chars, DOCX=${docContent.length} chars, KB=${kbContent.length} chars`);
}

export function findRelevantChunks(question) {
  const all = [...faqChunks, ...docChunks, ...kbChunks];
  if (!all.length) return null;

  const result = stringSimilarity.findBestMatch(question, all);

  return result.ratings
    .filter(r => r.rating > 0.25)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 2)
    .map(r => r.target)
    .join("\n");
}
