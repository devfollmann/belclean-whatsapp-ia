import 'dotenv/config';
import http from 'http';
import QRCode from 'qrcode';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { gerarResposta, extrairAgendamento } from './ia.js';
import { adicionarAgendamento, listarOcupados } from './agenda.js';
import {
  adicionarMensagem,
  ativarAtendimentoHumano,
  resetarAtendimentoHumano,
  estaEmAtendimentoHumano,
  obterHistorico,
} from './conversas.js';

const logger = pino({ level: 'silent' });

// Servidor HTTP para exibir o QR Code no navegador
let qrAtual = null;
const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  if (req.url === '/qr') {
    if (!qrAtual) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2 style="font-family:sans-serif;text-align:center;margin-top:80px">✅ WhatsApp já está conectado!<br>Nenhum QR Code pendente.</h2>');
      return;
    }
    const imgData = await QRCode.toDataURL(qrAtual, { width: 400 });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>BEL Clean - QR Code</title>
      <meta http-equiv="refresh" content="20">
      <style>body{font-family:sans-serif;text-align:center;padding:40px;background:#f5f5f5}
      img{border:8px solid #25D366;border-radius:16px;margin-top:20px}</style></head>
      <body><h2>📱 Escaneie com o WhatsApp</h2>
      <p>Configurações → Dispositivos conectados → Conectar dispositivo</p>
      <img src="${imgData}"/><p><small>A página atualiza sozinha a cada 20 segundos</small></p>
      </body></html>`);
  } else if (req.url === '/teste-ia') {
    try {
      const resposta = await gerarResposta(
        [{ role: 'user', parts: [{ text: 'Boa tarde' }] }, { role: 'model', parts: [{ text: 'Boa tarde! Como posso ajudar?' }] }],
        'Preciso limpar um sofá de 3 lugares em Goiânia',
        []
      );
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('SUCESSO:\n' + resposta);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ERRO:\n' + e.message);
    }
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('BEL Clean IA - ok');
  }
}).listen(PORT, () => console.log(`🌐 QR Code disponível em /qr (porta ${PORT})`));

// Fila por conversa para evitar race condition com mensagens simultâneas
const filas = new Map();

async function enfileirar(jid, fn) {
  if (!filas.has(jid)) filas.set(jid, Promise.resolve());
  const fila = filas.get(jid).then(fn).catch(() => {});
  filas.set(jid, fila);
  return fila;
}

// Número do dono — comandos /parar e /retomar só funcionam vindos deste número
const NUMERO_DONO = '556298519744' ; // seu número sem + e sem traço

const PALAVRAS_HUMANO = ['atendente', 'humano', 'falar com alguém', 'falar com alguem', 'pessoa real', 'operador'];

function pedindoAtendimentoHumano(texto) {
  const t = texto.toLowerCase();
  return PALAVRAS_HUMANO.some((p) => t.includes(p));
}

function ehDono(jid) {
  return jid.replace('@s.whatsapp.net', '') === NUMERO_DONO;
}

async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_baileys');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrAtual = qr;
      console.log('\n📱 Acesse /qr no seu navegador para escanear o QR Code\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const reconectar = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️  Conexão encerrada. Reconectar: ${reconectar}`);
      if (reconectar) {
        setTimeout(conectar, 3000);
      } else {
        console.log('❌ Deslogado. Delete a pasta auth_baileys e reinicie para escanear novamente.');
        process.exit(0);
      }
    }

    if (connection === 'open') {
      qrAtual = null;
      console.log('✅ BEL Clean IA conectada ao WhatsApp!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Ignorar mensagens de grupos, status e do próprio bot
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid.endsWith('@g.us')) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;

      const jid = msg.key.remoteJid;
      const texto =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        '';

      if (!texto.trim()) continue;

      console.log(`📩 [${jid}]: ${texto}`);

      enfileirar(jid, async () => {
        // Comandos do dono
        if (msg.key.fromMe && ehDono(jid)) {
          const match = texto.trim().match(/^\/(parar|retomar)\s+(\d+)/i);
          if (match) {
            const numero = match[2] + '@s.whatsapp.net';
            if (match[1].toLowerCase() === 'parar') {
              ativarAtendimentoHumano(numero);
              await sock.sendMessage(jid, { text: `✅ IA pausada para ${match[2]}. Você pode atender agora.` });
            } else {
              resetarAtendimentoHumano(numero);
              await sock.sendMessage(jid, { text: `✅ IA reativada para ${match[2]}.` });
            }
          }
          return;
        }

        // Ignorar se em atendimento humano
        if (estaEmAtendimentoHumano(jid)) {
          console.log(`👤 [${jid}] Em atendimento humano — IA silenciada.`);
          return;
        }

        // Verificar se está pedindo atendimento humano
        if (pedindoAtendimentoHumano(texto)) {
          ativarAtendimentoHumano(jid);
          await sock.sendMessage(jid, { text: 'Claro! Vou chamar nossa equipe. Um momento, já te atendo pessoalmente! 👋' });
          console.log(`👤 [${jid}] Handoff para humano ativado.`);
          return;
        }

        const historico = obterHistorico(jid);
        adicionarMensagem(jid, 'user', texto);

        try {
          await sock.sendPresenceUpdate('composing', jid);
          const resposta = await gerarResposta(historico, texto, listarOcupados());
          await sock.sendPresenceUpdate('paused', jid);
          adicionarMensagem(jid, 'model', resposta);
          await sock.sendMessage(jid, { text: resposta });

          if (resposta.includes('agendamento realizado com sucesso')) {
            extrairAgendamento(obterHistorico(jid)).then((dados) => {
              if (dados?.data) {
                adicionarAgendamento({ ...dados, cliente: jid });
                console.log(`📅 Agendamento salvo: ${dados.data} às ${dados.horario}`);
              }
            });
          }
          console.log(`🤖 [${jid}]: ${resposta.substring(0, 80)}...`);
        } catch (err) {
          console.error(`Erro ao responder [${jid}]:`, err.message);
        }
      });
    }
  });
}

conectar();
