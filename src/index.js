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
import { gerarResposta, extrairAgendamento, transcreverAudio, analisarImagem } from './ia.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { adicionarAgendamento, listarOcupados, listarAgendamentos, cancelarAgendamento } from './agenda.js';
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
let whatsappConectado = false;
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
  } else if (req.url === '/agendamentos') {
    const lista = listarAgendamentos();
    const linhas = lista.length === 0
      ? '<p style="color:#888">Nenhum agendamento registrado.</p>'
      : lista.map((a, i) => `
          <tr>
            <td>${a.data}</td>
            <td>${a.horario}</td>
            <td>${a.servico || '-'}</td>
            <td>${a.cidade || '-'}</td>
            <td>${a.cliente?.replace('@s.whatsapp.net','').replace('@lid','') || '-'}</td>
            <td><a href="/cancelar?data=${encodeURIComponent(a.data)}&horario=${encodeURIComponent(a.horario)}" onclick="return confirm('Cancelar este agendamento?')" style="color:red">Cancelar</a></td>
          </tr>`).join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Agendamentos BEL Clean</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>body{font-family:sans-serif;padding:20px;background:#f5f5f5}
      h2{color:#25D366}table{border-collapse:collapse;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px #0001}
      th{background:#25D366;color:#fff;padding:10px 14px;text-align:left}
      td{padding:10px 14px;border-bottom:1px solid #eee}tr:last-child td{border:none}
      a{text-decoration:none;font-weight:bold}</style></head>
      <body><h2>📅 Agendamentos BEL Clean</h2>
      <table><thead><tr><th>Data</th><th>Horário</th><th>Serviço</th><th>Cidade</th><th>Cliente</th><th>Ação</th></tr></thead>
      <tbody>${linhas}</tbody></table>
      <p style="margin-top:16px;color:#888;font-size:13px">Total: ${lista.length} agendamento(s)</p>
      </body></html>`);
  } else if (req.url?.startsWith('/cancelar')) {
    const params = new URL(req.url, `http://localhost`).searchParams;
    const data = params.get('data');
    const horario = params.get('horario');
    const ok = cancelarAgendamento(data, horario);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="2;url=/agendamentos">
      <style>body{font-family:sans-serif;text-align:center;padding:60px;background:#f5f5f5}</style></head>
      <body><h3>${ok ? '✅ Agendamento cancelado!' : '⚠️ Agendamento não encontrado.'}</h3>
      <p>Redirecionando...</p></body></html>`);
  } else if (req.url === '/status') {
    if (whatsappConectado) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'conectado' }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'desconectado' }));
    }
  } else if (req.url === '/teste-ia') {
    try {
      const Groq = (await import('groq-sdk')).default;
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await groq.chat.completions.create({
        model: 'qwen/qwen3.8-27b',
        messages: [{ role: 'user', content: 'Diga apenas: funcionou!' }],
        max_tokens: 20,
      });
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('SUCESSO:\n' + completion.choices[0].message.content);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ERRO GROQ:\n' + e.message + '\nChave: ' + (process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.substring(0,10) + '...' : 'VAZIA'));
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

const PALAVRAS_HUMANO = ['atendente', 'humano', 'falar com alguém', 'falar com alguem', 'pessoa real', 'falar com operador', 'quero operador'];

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
      whatsappConectado = false;
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
      whatsappConectado = true;
      console.log('✅ BEL Clean IA conectada ao WhatsApp!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.remoteJid.endsWith('@g.us')) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;
      if (msg.key.remoteJid.endsWith('@newsletter')) continue;
      if (msg.key.remoteJid.endsWith('@broadcast')) continue;

      const jid = msg.key.remoteJid;

      // Comandos do dono (mensagens enviadas pelo próprio número)
      if (msg.key.fromMe) {
        const textoCmd = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

        // Comando /agendamentos
        if (textoCmd.trim().toLowerCase() === '/agendamentos') {
          const lista = listarAgendamentos();
          if (lista.length === 0) {
            await sock.sendMessage(jid, { text: '📅 Nenhum agendamento registrado.' });
          } else {
            const resumo = lista.map((a, i) =>
              `${i+1}. ${a.data} às ${a.horario} — ${a.servico || 'serviço'} (${a.cidade || 'cidade'})`
            ).join('\n');
            await sock.sendMessage(jid, { text: `📅 *Agendamentos:*\n\n${resumo}\n\nPara cancelar: /cancelar DD/MM HH:MM` });
          }
          continue;
        }

        // Comando /cancelar DD/MM HH:MM
        const matchCancelar = textoCmd.trim().match(/^\/cancelar\s+(\d{2}\/\d{2})\s+(\d{2}:\d{2})/i);
        if (matchCancelar) {
          const ok = cancelarAgendamento(matchCancelar[1], matchCancelar[2]);
          await sock.sendMessage(jid, { text: ok ? `✅ Agendamento de ${matchCancelar[1]} às ${matchCancelar[2]} cancelado.` : `⚠️ Agendamento não encontrado.` });
          continue;
        }

        const match = textoCmd.trim().match(/^\/(parar|retomar)\s+([\d@a-z.]+)/i);
        if (match) {
          const entrada = match[2].trim();
          let numero;
          if (entrada.includes('@')) {
            // JID completo informado (ex: 19314635714732@lid)
            numero = entrada;
          } else {
            let digitos = entrada.replace(/\D/g, '');
            if (!digitos.startsWith('55')) digitos = '55' + digitos;
            numero = digitos + '@s.whatsapp.net';
          }
          if (match[1].toLowerCase() === 'parar') {
            ativarAtendimentoHumano(numero);
            await sock.sendMessage(jid, { text: `✅ IA pausada para ${numero}. Você pode atender agora.` });
          } else {
            resetarAtendimentoHumano(numero);
            await sock.sendMessage(jid, { text: `✅ IA reativada para ${numero}.` });
          }
        }
        continue;
      }
      const isLocalizacao = !!msg.message?.locationMessage;
      const isAudio = !!msg.message?.audioMessage;

      let texto = '';
      if (isLocalizacao) {
        texto = '[cliente enviou a localização]';
      } else if (isAudio) {
        try {
          await sock.sendPresenceUpdate('composing', jid);
          const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
          const transcricao = await transcreverAudio(buffer);
          if (transcricao) {
            texto = transcricao;
            console.log(`🎤 [${jid}] Áudio transcrito: ${transcricao}`);
          } else {
            await sock.sendMessage(jid, { text: 'Não consegui entender o áudio 😕 Pode digitar sua mensagem?' });
            continue;
          }
        } catch (err) {
          console.error(`Erro ao processar áudio [${jid}]:`, err.message);
          await sock.sendMessage(jid, { text: 'Não consegui processar o áudio 😕 Pode digitar sua mensagem?' });
          continue;
        }
      } else {
        const isImagem = !!msg.message?.imageMessage;
        if (isImagem) {
          try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
            const ehEstofado = await analisarImagem(buffer);
            if (ehEstofado) {
              texto = '[cliente enviou uma foto do item]';
            } else {
              await sock.sendMessage(jid, { text: 'Hmm, essa imagem não parece ser de um sofá, colchão ou outro item que higienizamos 😅 Pode enviar uma foto do item que deseja limpar?' });
              continue;
            }
          } catch (err) {
            console.error(`Erro ao processar imagem [${jid}]:`, err.message);
            texto = '[cliente enviou uma foto do item]';
          }
        } else {
          texto = msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            '';
        }
      }

      if (!texto.trim()) continue;

      console.log(`📩 [${jid}]: ${texto}`);

      enfileirar(jid, async () => {
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
