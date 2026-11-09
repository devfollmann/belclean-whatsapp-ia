import 'dotenv/config';
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
      console.log('\n📱 Escaneie o QR Code abaixo com o WhatsApp:\n');
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

      // Comandos do dono (mensagens enviadas para si mesmo)
      if (msg.key.fromMe && ehDono(jid)) {
        const cmd = texto.trim().toLowerCase();
        const match = cmd.match(/^\/(parar|retomar)\s+(\d+)/);
        if (match) {
          const acao = match[1];
          const numero = match[2] + '@s.whatsapp.net';
          if (acao === 'parar') {
            ativarAtendimentoHumano(numero);
            await sock.sendMessage(jid, { text: `✅ IA pausada para ${match[2]}. Você pode atender agora.` });
            console.log(`⏸️  IA pausada para ${numero} pelo dono.`);
          } else {
            resetarAtendimentoHumano(numero);
            await sock.sendMessage(jid, { text: `✅ IA reativada para ${match[2]}.` });
            console.log(`▶️  IA reativada para ${numero} pelo dono.`);
          }
        }
        continue;
      }

      // Verificar se está em atendimento humano
      if (estaEmAtendimentoHumano(jid)) {
        console.log(`👤 [${jid}] Em atendimento humano — IA silenciada.`);
        continue;
      }

      // Verificar se está pedindo atendimento humano
      if (pedindoAtendimentoHumano(texto)) {
        ativarAtendimentoHumano(jid);
        const aviso = 'Claro! Vou chamar nossa equipe. Um momento, já te atendo pessoalmente! 👋';
        await sock.sendMessage(jid, { text: aviso });
        console.log(`👤 [${jid}] Handoff para humano ativado.`);
        continue;
      }

      // Buscar histórico da conversa (sem a mensagem atual)
      const historico = obterHistorico(jid);

      // Adicionar mensagem do usuário ao histórico
      adicionarMensagem(jid, 'user', texto);

      // Gerar resposta com IA
      try {
        await sock.sendPresenceUpdate('composing', jid);
        const ocupados = listarOcupados();
        const resposta = await gerarResposta(historico, texto, ocupados);
        await sock.sendPresenceUpdate('paused', jid);

        adicionarMensagem(jid, 'model', resposta);

        await sock.sendMessage(jid, { text: resposta });

        // Detectar confirmação de agendamento e salvar
        if (resposta.includes('agendamento realizado com sucesso')) {
          const historioCompleto = obterHistorico(jid);
          extrairAgendamento(historioCompleto).then((dados) => {
            if (dados?.data) {
              adicionarAgendamento({ ...dados, cliente: jid });
              console.log(`📅 Agendamento salvo: ${dados.data} às ${dados.horario} — ${dados.servico} em ${dados.cidade}`);
            }
          });
        }
        console.log(`🤖 [${jid}]: ${resposta.substring(0, 80)}...`);
      } catch (err) {
        console.error(`Erro ao responder [${jid}]:`, err.message);
      }
    }
  });
}

conectar();
