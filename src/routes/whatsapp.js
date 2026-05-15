import { Router } from "express";
import { getQRCode, getStatus, sendMessage } from "../services/whatsapp-client.js";
import { processMessage } from "../services/whatsapp-message.js";

const router = Router();

router.post("/webhook", async (req, res) => {
  const { message, from } = req.body;
  if (!message || !from) {
    return res.status(400).json({ error: "message e from são obrigatórios" });
  }

  const chatId = `webhook_${from}`;
  const reply = await processMessage(message, chatId, from);
  res.json({ reply });
});

router.get("/qrcode", (req, res) => {
  const qr = getQRCode();
  if (!qr) {
    return res.json({ qr: null, status: getStatus(), message: "QR code indisponível. Status: " + getStatus() });
  }
  res.json({ qr, status: getStatus() });
});

router.get("/status", (req, res) => {
  res.json({
    status: getStatus(),
    hasQR: !!getQRCode(),
  });
});

router.post("/send", async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: "to e message são obrigatórios" });
  }
  try {
    await sendMessage(to, message);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
