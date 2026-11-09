// Histórico de conversas em memória: { [jid]: { historico, atendimentoHumano, ultimaAtividade } }
const conversas = new Map();

const MAX_MSGS = 20;        // mensagens por conversa
const TTL_HORAS = 6;        // limpar conversas inativas após 6h

export function resetarAtendimentoHumano(jid) {
  obterConversa(jid).atendimentoHumano = false;
}

export function obterConversa(jid) {
  if (!conversas.has(jid)) {
    conversas.set(jid, { historico: [], atendimentoHumano: false, ultimaAtividade: Date.now() });
  }
  return conversas.get(jid);
}

export function adicionarMensagem(jid, role, texto) {
  const conversa = obterConversa(jid);
  conversa.historico.push({ role, parts: [{ text: texto }] });
  conversa.ultimaAtividade = Date.now();

  // Manter apenas as últimas MAX_MSGS mensagens
  if (conversa.historico.length > MAX_MSGS) {
    conversa.historico = conversa.historico.slice(-MAX_MSGS);
  }
}

export function ativarAtendimentoHumano(jid) {
  const conversa = obterConversa(jid);
  conversa.atendimentoHumano = true;
}

export function estaEmAtendimentoHumano(jid) {
  return obterConversa(jid).atendimentoHumano;
}

export function obterHistorico(jid) {
  return [...obterConversa(jid).historico];
}

// Limpar conversas antigas a cada 1 hora
setInterval(() => {
  const agora = Date.now();
  const limite = TTL_HORAS * 60 * 60 * 1000;
  for (const [jid, dados] of conversas.entries()) {
    if (agora - dados.ultimaAtividade > limite) {
      conversas.delete(jid);
    }
  }
}, 60 * 60 * 1000);
