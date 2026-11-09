import { GoogleGenerativeAI } from '@google/generative-ai';
import { gerarPrompt } from './prompt.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function criarModel(horariosOcupados) {
  return genAI.getGenerativeModel({
    model: 'gemini-3.5-flash',
    systemInstruction: gerarPrompt(horariosOcupados),
    generationConfig: { maxOutputTokens: 500, temperature: 0.7 },
  });
}

export async function gerarResposta(historico, mensagemNova, horariosOcupados = []) {
  const model = criarModel(horariosOcupados);
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const chat = model.startChat({ history: historico });
      const result = await chat.sendMessage(mensagemNova);
      return result.response.text();
    } catch (err) {
      console.error(`Erro na IA (tentativa ${tentativa}/3):`, err.message);
      if (tentativa < 3) await sleep(2000 * tentativa);
    }
  }
  return 'Desculpe, tive um probleminha aqui. Pode repetir sua mensagem? 😊';
}

// Extrai data e horário do agendamento confirmado usando a própria IA
export async function extrairAgendamento(historico) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash',
    generationConfig: { maxOutputTokens: 100, temperature: 0 },
  });
  const conversa = historico
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Bela'}: ${m.parts[0].text}`)
    .join('\n');
  try {
    const result = await model.generateContent(
      `Da conversa abaixo, extraia SOMENTE em JSON (sem markdown): {"data":"DD/MM","horario":"HH:MM","servico":"...","cidade":"..."}\nSe não encontrar data ou horário claros, retorne: {"data":null}\n\nConversa:\n${conversa}`
    );
    const texto = result.response.text().replace(/```json|```/g, '').trim();
    return JSON.parse(texto);
  } catch {
    return { data: null };
  }
}
