# 🤖 Chatbot Microterminal — ThR

Bot de suporte via WhatsApp para o microterminal ThR. Atende clientes com problemas de conexão, guia pela configuração de IP e aciona o suporte humano quando necessário.

---

## 📋 Índice

1. [O que o bot faz](#o-que-o-bot-faz)
2. [Tecnologias](#tecnologias)
3. [Instalação local](#instalação-local)
4. [Variáveis de ambiente](#variáveis-de-ambiente)
5. [Como rodar](#como-rodar)
6. [Testes](#testes)
7. [Deploy no Render](#deploy-no-render)
8. [Conectar ao WhatsApp (Meta)](#conectar-ao-whatsapp-meta)
9. [Estrutura de pastas](#estrutura-de-pastas)
10. [Fluxo da conversa](#fluxo-da-conversa)

---

## O que o bot faz

- Atende clientes que entram em contato pelo WhatsApp com problemas no microterminal
- Guia passo a passo para configurar o IP do servidor no terminal
- Detecta se está dentro do **horário comercial** (seg–sex 8h–18h, Brasília)
- Avisa o cliente antes da **sessão expirar** por inatividade
- Aciona **suporte humano** quando não consegue resolver
- Recebe **áudio** (transcreve via Groq/Whisper) e **imagens** (analisa via Claude)
- Ignora graciosamente vídeos, documentos, stickers e outros tipos de mídia

---

## Tecnologias

| Recurso | Tecnologia |
|---|---|
| Servidor | Node.js + Express |
| WhatsApp | Meta WhatsApp Cloud API |
| IA / RAG | Anthropic Claude (claude-sonnet-4-6) |
| Áudio | Groq Whisper (grátis) |
| Banco de sessões | SQLite (better-sqlite3) |
| Deploy | Render.com |

---

## Instalação local

```bash
# 1. Clone o repositório
git clone https://github.com/anajuliathr-glitch/chatbot-microterminal.git
cd chatbot-microterminal

# 2. Instale as dependências
npm install

# 3. Configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com seus valores (veja seção abaixo)

# 4. Inicie o servidor
node server.js
```

O servidor sobe em `http://localhost:3001`.

---

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ Para IA | Chave do Claude (console.anthropic.com) |
| `META_TOKEN` | ✅ Para WhatsApp | Token da Meta Cloud API (começa com EAA...) |
| `META_PHONE_ID` | ✅ Para WhatsApp | ID do número de telefone no Meta |
| `META_VERIFY_TOKEN` | ✅ Para webhook | Token de verificação (qualquer string segura) |
| `GROQ_API_KEY` | Recomendado | Transcrição de áudio grátis (console.groq.com) |
| `SUPPORT_PHONE` | Recomendado | Número que recebe alerta de suporte (ex: 5511999...) |
| `PORT` | Não | Porta do servidor (padrão: 3001) |
| `SESSION_TIMEOUT` | Não | Timeout de sessão em ms (padrão: 900000 = 15min) |
| `CORS_ORIGIN` | Não | Origem permitida no CORS (padrão: *) |

---

## Como rodar

### Desenvolvimento
```bash
node server.js
```

### Com variável de ambiente inline
```bash
NODE_ENV=development node server.js
```

### Modo teste (sem rate limit, com endpoints de teste)
```bash
NODE_ENV=test node server.js
```

O servidor também abre um terminal interativo para conversar com o bot diretamente pelo console.

---

## Testes

O projeto tem 4 suítes de teste. Todas rodam com o servidor já iniciado com `NODE_ENV=test`.

### 1. SWAT (314 testes unitários)
Cobre todos os fluxos da conversa: nome, problema, IP, configuração, escalação, horário, erros, etc.
```bash
NODE_ENV=test node test_swat.mjs
```

### 2. Sessão (expiração e reinício)
Testa o comportamento quando a sessão expira por inatividade.
```bash
NODE_ENV=test node test_sessao.mjs
```

### 3. Horário Comercial
Valida a lógica de seg–sex 8h–18h para 17 cenários diferentes.
```bash
node test_horario.mjs
```

### 4. Carga (50 ou 100 usuários simultâneos)
```bash
# 50 usuários (padrão)
NODE_ENV=test node test_carga.mjs

# 100 usuários (stress test)
NODE_ENV=test node test_carga.mjs 100
```

### Últimos resultados
| Teste | Resultado |
|---|---|
| SWAT | ✅ 314/314 (100%) |
| Sessão | ✅ Todos passando |
| Horário | ✅ 19/19 (100%) |
| Carga 50 usuários | ✅ EXCELENTE — P95: 116ms |
| Carga 100 usuários | ✅ EXCELENTE — P95: 156ms |

---

## Deploy no Render

### Primeira vez

1. Acesse [render.com](https://render.com) e faça login
2. Clique em **New → Web Service**
3. Conecte o repositório `chatbot-microterminal`
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** `Node`
5. Adicione as variáveis de ambiente (aba **Environment**):
   - `ANTHROPIC_API_KEY`
   - `META_TOKEN`
   - `META_PHONE_ID`
   - `META_VERIFY_TOKEN=microterminal-thr-2024`
   - `GROQ_API_KEY`
   - `SUPPORT_PHONE`
6. Clique em **Deploy**

### Atualizar após push
O Render faz deploy automático quando você faz `git push origin main`.

Para forçar: Render Dashboard → seu serviço → **Manual Deploy → Deploy latest commit**.

### URL do webhook
Após o deploy, sua URL será algo como:
```
https://chatbot-microterminal.onrender.com
```

O webhook do WhatsApp fica em:
```
https://chatbot-microterminal.onrender.com/whatsapp-meta/webhook
```

---

## Conectar ao WhatsApp (Meta)

> ⚠️ Você precisará de acesso ao [Meta for Developers](https://developers.facebook.com).

### Passo a passo

**1. Criar o App no Meta**
- Acesse [developers.facebook.com](https://developers.facebook.com)
- Clique em **Meus Apps → Criar App**
- Escolha tipo **Business**
- Adicione o produto **WhatsApp**

**2. Configurar o Webhook**
- Em **WhatsApp → Configuração**, cole a URL do webhook:
  ```
  https://SEU-APP.onrender.com/whatsapp-meta/webhook
  ```
- Token de verificação: `microterminal-thr-2024`
- Assine o campo **messages**

**3. Copiar as credenciais**
- **Token de acesso:** campo "Token de acesso temporário" (começa com `EAA...`)
- **Phone Number ID:** ID numérico exibido em "Número de telefone"

**4. Adicionar no Render**
- Vá em: Render Dashboard → seu serviço → **Environment**
- Adicione:
  - `META_TOKEN` = o token copiado
  - `META_PHONE_ID` = o ID numérico

**5. Verificar**
Acesse:
```
https://SEU-APP.onrender.com/whatsapp-meta/status
```
Deve retornar `"configurado": "sim"`.

---

## Estrutura de pastas

```
chatbot-microterminal/
├── server.js                    # Ponto de entrada, rotas principais
├── src/
│   ├── config.js                # Configurações e variáveis de ambiente
│   ├── routes/
│   │   ├── chat.js              # Endpoint HTTP /chat (web/testes)
│   │   ├── whatsapp.js          # Z-API (legado)
│   │   └── whatsapp-meta.js     # Meta WhatsApp Cloud API
│   └── services/
│       ├── ai.js                # RAG + Claude + análise de imagem
│       ├── document.js          # Carrega documentos de suporte
│       ├── logger.js            # Log de mensagens
│       ├── meta.js              # Envio de mensagens via Meta API
│       ├── session.js           # Gerenciamento de sessões (SQLite + memória)
│       ├── session-watcher.js   # Aviso automático antes de sessão expirar
│       ├── transcription.js     # Transcrição de áudio
│       ├── whatsapp-client.js   # Cliente Z-API (legado)
│       └── whatsapp-message.js  # Processador de mensagens WhatsApp
├── documents/                   # Base de conhecimento (arquivos .docx)
├── test_swat.mjs                # 314 testes de fluxo
├── test_sessao.mjs              # Testes de expiração de sessão
├── test_horario.mjs             # Testes de horário comercial
├── test_carga.mjs               # Testes de carga (N usuários simultâneos)
├── .env.example                 # Modelo de variáveis de ambiente
└── sessions.db                  # Banco SQLite (gerado automaticamente, não commitar)
```

---

## Fluxo da conversa

```
Cliente manda "oi"
        │
        ▼
   [start] → saudação + pede nome
        │
        ▼
   [ask_name] → extrai primeiro nome válido
        │
        ▼
   [ask_problem] → identifica o problema
        │
   ┌────┴────────────────────────────┐
   │ RAG encontrou solução?          │
   ▼ sim                      não ▼ │
[rag_followup]           [ask_ip] ←─┘
   │                         │
   │ resolveu?           manda IP?
   ▼ sim   não ▼              │
[final]  [ask_ip]      [teach_ip] → ensina a achar
                            │
                            ▼
                    [config_terminal] → passo a passo do P
                            │
                    resolveu?  não (3x)?
                    ▼ sim        ▼
                 [confirm_done]  [escalation]
                       │              │
                    [final]      suporte humano notificado
```

### Horário de atendimento
- **Dentro do horário** (seg–sex 8h–18h, Brasília): atendimento normal
- **Fora do horário**: avisa o cliente mas continua atendendo — caso não resolva, técnico entra em contato no próximo dia útil

### Expiração de sessão
- **10 minutos** sem resposta → bot envia aviso automático pelo WhatsApp
- **15 minutos** sem resposta → sessão expira, próxima mensagem reinicia do zero

---

## Créditos

Desenvolvido para **ThR** — Tecnologia em Hardware e Redes.
