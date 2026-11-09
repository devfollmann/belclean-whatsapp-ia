import { readFileSync, writeFileSync, existsSync } from 'fs';

const ARQUIVO = './agendamentos.json';

function carregar() {
  if (!existsSync(ARQUIVO)) return [];
  try { return JSON.parse(readFileSync(ARQUIVO, 'utf8')); } catch { return []; }
}

function salvar(lista) {
  writeFileSync(ARQUIVO, JSON.stringify(lista, null, 2));
}

export function adicionarAgendamento({ data, horario, servico, cidade, cliente }) {
  const lista = carregar();
  lista.push({ data, horario, servico, cidade, cliente, criadoEm: new Date().toISOString() });
  salvar(lista);
}

export function listarOcupados() {
  return carregar().map((a) => `${a.data} às ${a.horario}`);
}
