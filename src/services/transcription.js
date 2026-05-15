import fetch from "node-fetch";
import config from "../config.js";

export async function transcribeAudio(audioUrl) {
  try {
    if (!config.openaiKey) {
      console.warn("⚠️ OPENAI_API_KEY não configurada — transcrição desativada");
      return null;
    }

    // Baixa o áudio da URL do Z-API
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) throw new Error("Falha ao baixar áudio");

    const audioBuffer = await audioResponse.arrayBuffer();
    const audioBlob = new Blob([audioBuffer], { type: "audio/ogg" });

    // Envia para o Whisper
    const formData = new FormData();
    formData.append("file", audioBlob, "audio.ogg");
    formData.append("model", "whisper-1");
    formData.append("language", "pt");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.openaiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      console.error("Erro Whisper:", await response.text());
      return null;
    }

    const data = await response.json();
    console.log(`🎙️ Áudio transcrito: "${data.text}"`);
    return data.text;

  } catch (e) {
    console.error("Erro transcrição:", e.message);
    return null;
  }
}
