import fetch from "node-fetch";
import config from "../config.js";

export async function transcribeAudio(audioUrl) {
  try {
    const key = config.groqKey || config.openaiKey;
    if (!key) {
      console.warn("⚠️ Nenhuma chave de transcrição configurada (GROQ_API_KEY ou OPENAI_API_KEY)");
      return null;
    }

    const useGroq = !!config.groqKey;
    const apiUrl = useGroq
      ? "https://api.groq.com/openai/v1/audio/transcriptions"
      : "https://api.openai.com/v1/audio/transcriptions";
    const model = useGroq ? "whisper-large-v3-turbo" : "whisper-1";

    console.log(`🎙️ Transcrevendo via ${useGroq ? "Groq (grátis)" : "OpenAI"}...`);

    // Baixa o áudio
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) throw new Error("Falha ao baixar áudio");

    const audioBuffer = await audioResponse.arrayBuffer();
    const audioBlob = new Blob([audioBuffer], { type: "audio/ogg" });

    const formData = new FormData();
    formData.append("file", audioBlob, "audio.ogg");
    formData.append("model", model);
    formData.append("language", "pt");

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}` },
      body: formData,
    });

    if (!response.ok) {
      console.error("Erro transcrição:", await response.text());
      return null;
    }

    const data = await response.json();
    console.log(`🎙️ Transcrito: "${data.text}"`);
    return data.text;

  } catch (e) {
    console.error("Erro transcrição:", e.message);
    return null;
  }
}
