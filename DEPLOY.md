# BEL Clean — IA no WhatsApp (Deploy Gratuito)

## Stack utilizada (100% gratuita)
- **Baileys** — conecta ao WhatsApp via QR Code
- **Google Gemini Flash** — IA para responder (plano gratuito)
- **Render.com** — hospedagem gratuita 24h
- **GitHub** — repositório do código

---

## PASSO 1 — Pegar a chave da API do Gemini (gratuita)

1. Acesse: https://aistudio.google.com/app/apikey
2. Faça login com sua conta Google
3. Clique em **"Create API key"**
4. Copie a chave gerada (começa com `AIza...`)

---

## PASSO 2 — Subir o código no GitHub

1. Crie uma conta em https://github.com (se não tiver)
2. Clique em **"New repository"** → nome: `belclean-whatsapp-ia` → **Create**
3. No seu computador, abra o terminal dentro da pasta `belclean-whatsapp-ia` e rode:

```bash
git init
git add .
git commit -m "BEL Clean IA WhatsApp"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/belclean-whatsapp-ia.git
git push -u origin main
```

---

## PASSO 3 — Deploy no Render.com

1. Acesse: https://render.com e crie uma conta gratuita
2. Clique em **"New"** → **"Web Service"**
3. Conecte seu GitHub e selecione o repositório `belclean-whatsapp-ia`
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
5. Em **"Environment Variables"**, adicione:
   - `GEMINI_API_KEY` = sua chave do Gemini
6. Em **"Disks"** (aba avançada), adicione um disco:
   - **Mount Path:** `/opt/render/project/src/auth_baileys`
   - **Size:** 1 GB (gratuito)
7. Clique em **"Create Web Service"**

---

## PASSO 4 — Escanear o QR Code

1. Após o deploy, acesse os **Logs** do serviço no Render
2. Um QR Code vai aparecer no terminal
3. No seu WhatsApp → **Dispositivos conectados** → **Conectar dispositivo**
4. Escaneie o QR Code

✅ Pronto! A IA já está respondendo seus clientes.

---

## COMO FUNCIONA

| Situação | O que acontece |
|---|---|
| Cliente manda mensagem | IA responde automaticamente |
| Cliente digita "atendente" ou "humano" | IA para de responder, você atende |
| Mensagem de grupo | Ignorada completamente |
| Fora do horário | IA informa o horário de retorno |

---

## TESTAR LOCALMENTE (opcional)

1. Instale o Node.js 20+ em https://nodejs.org
2. Renomeie `.env.example` para `.env` e cole sua chave do Gemini
3. Na pasta do projeto, rode:

```bash
npm install
npm start
```

4. Escaneie o QR Code que aparecer no terminal
5. Envie uma mensagem para o seu próprio número para testar

---

## ATUALIZAR O BOT

Para mudar preços, horários ou qualquer informação, edite o arquivo `src/prompt.js`, salve e faça um novo `git push`. O Render vai atualizar automaticamente.
