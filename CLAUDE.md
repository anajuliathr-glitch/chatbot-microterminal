# chatbot-microterminal — Referência rápida

## URLs de produção (Render)
| Endpoint | URL |
|---|---|
| QR Code WhatsApp | https://chatbot-microterminal.onrender.com/whatsapp/qrcode |
| Restart conexão | https://chatbot-microterminal.onrender.com/whatsapp/restart |
| Analytics dashboard | https://chatbot-microterminal.onrender.com/analytics (senha: `thr2024`) |
| Health check | https://chatbot-microterminal.onrender.com/health |
| Chat API | https://chatbot-microterminal.onrender.com/chat |

## Número oficial do WhatsApp
- **15996073174** — para ativar, escanear QR com esse celular em /whatsapp/qrcode
- O número é determinado pelo celular que escaneia o QR — não é configurado em código

## Testes
```bash
# Antes de rodar testes: mudar .env para NODE_ENV=test
# Rodar:
node test_swat.mjs
# Restaurar: NODE_ENV=development
```
- Suite atual: **603 testes, 100% passando** (Blocos A–V)

## Arquitetura
- `src/services/chat-core.js` — lógica central (state machine), usado por ambos os canais
- `src/routes/chat.js` — wrapper HTTP/API
- `src/services/whatsapp-message.js` — wrapper WhatsApp (Baileys)
- `src/services/analytics.js` — logger JSONL fire-and-forget
- `src/routes/analytics.js` — dashboard web

## OpenRouter (IA gratuita)
- Chave: `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`
- Modelo principal: `openai/gpt-oss-120b:free` (RAG + respostas)
- Modelo classificação: `openai/gpt-oss-20b:free` (intent detection, mais rápido)
- Dashboard: https://openrouter.ai/settings/keys

## Upstash Redis (analytics persistente)
- URL: `https://safe-lionfish-137483.upstash.io`
- Token: `gQAAAAAAAhkLAAIgcDJlOTAxMGU5Y2EwNmY0ZjM3OTM5NmQ3NTEzNTJmNmM1Nw`
- Configurado no `.env` e deve estar no Render → Environment Variables

## Pendências de infraestrutura
- [ ] Render Disk persistente ($1/mês, requer plano Starter $7/mês) — para sessão WhatsApp sobreviver restarts
- [ ] Créditos Anthropic (~$10) — ativar IA/RAG para entender qualquer mensagem
- [ ] Créditos OpenAI (~$5) — transcrição de áudios do WhatsApp
