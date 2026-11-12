import Groq from 'groq-sdk';
import { gerarPrompt } from './prompt.js';
import { toFile } from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function gerarResposta(historico, mensagemNova, horariosOcupados = []) {
  const conversaAnterior = historico
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Bela'}: ${m.parts[0].text}`)
    .join('\n');

  const mensagemCompleta = conversaAnterior
    ? `${conversaAnterior}\nCliente: ${mensagemNova}`
    : `Cliente: ${mensagemNova}`;

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const completion = await groq.chat.completions.create({
        model: 'qwen/qwen3.8-27b',
        messages: [
          { role: 'system', content: gerarPrompt(horariosOcupados) },
          { role: 'user', content: mensagemCompleta },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });
      return completion.choices[0].message.content.trim();
    } catch (err) {
      console.error(`Erro na IA (tentativa ${tentativa}/3):`, err.message);
      if (tentativa < 3) await sleep(2000 * tentativa);
    }
  }
  return 'Desculpe, tive um probleminha aqui. Pode repetir sua mensagem? 😊';
}

export async function analisarImagem(buffer) {
  try {
    const base64 = buffer.toString('base64');
    const completion = await groq.chat.completions.create({
      model: 'llama-3.2-11b-vision-preview',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64}` },
            },
            {
              type: 'text',
              text: 'Esta imagem mostra algum item de estofaria ou limpeza como sofá, poltrona, cadeira, colchão, tapete, banco de carro ou cabeceira? Responda apenas: SIM ou NÃO.',
            },
          ],
        },
      ],
      max_tokens: 10,
      temperature: 0,
    });
    const resposta = completion.choices[0].message.content.trim().toUpperCase();
    return resposta.includes('SIM');
  } catch (err) {
    console.error('Erro ao analisar imagem:', err.message);
    return true; // em caso de erro, aceita a imagem para não bloquear o cliente
  }
}

export async function transcreverAudio(buffer) {
  try {
    const file = await toFile(buffer, 'audio.ogg', { type: 'audio/ogg' });
    const transcription = await groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3',
      language: 'pt',
    });
    return transcription.text?.trim() || null;
  } catch (err) {
    console.error('Erro na transcrição de áudio:', err.message);
    return null;
  }
}

export async function extrairAgendamento(historico) {
  const conversa = historico
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Bela'}: ${m.parts[0].text}`)
    .join('\n');
  try {
    const completion = await groq.chat.completions.create({
      model: 'qwen/qwen3.8-27b',
      messages: [
        {
          role: 'user',
          content: `Da conversa abaixo, extraia SOMENTE em JSON (sem markdown): {"data":"DD/MM","horario":"HH:MM","servico":"...","cidade":"..."}\nSe não encontrar data ou horário claros, retorne: {"data":null}\n\nConversa:\n${conversa}`,
        },
      ],
      max_tokens: 100,
      temperature: 0,
    });
    const texto = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    return JSON.parse(texto);
  } catch {
    return { data: null };
  }
}
