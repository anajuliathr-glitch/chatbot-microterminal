import fs from "fs";
import mammoth from "mammoth";
import stringSimilarity from "string-similarity";

let faqContent = "";
let docContent = "";
let faqChunks = [];
let docChunks = [];

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

  initChunks();
  console.log(`📚 Documentos carregados: FAQ=${faqContent.length} chars, DOCX=${docContent.length} chars`);
}

export function findRelevantChunks(question) {
  const all = [...faqChunks, ...docChunks];
  if (!all.length) return null;

  const result = stringSimilarity.findBestMatch(question, all);

  return result.ratings
    .filter(r => r.rating > 0.25)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 2)
    .map(r => r.target)
    .join("\n");
}
