import { execSync } from 'node:child_process';

/**
 * Libera as portas do ambiente de desenvolvimento.
 *
 * Ctrl+C no `pnpm dev` nem sempre derruba os processos filhos: o pnpm roda API
 * e painel em paralelo e o sinal nem sempre chega aos dois. O que sobra e um
 * servidor orfao segurando a porta, e a proxima tentativa falha com EADDRINUSE
 * — as vezes so de um lado, o que confunde ainda mais, porque metade do sistema
 * sobe e a outra nao.
 */

const PORTAS = [3000, 3333];

/** Roda o comando e devolve a saida, ou string vazia se ele falhar. */
function tentar(comando) {
  try {
    // As tres ferramentas saem com codigo diferente de zero quando nao ha
    // resultado, o que aqui e resposta valida e nao erro.
    return execSync(comando, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/**
 * PIDs escutando na porta. Vazio se ninguem estiver.
 *
 * Sao tres comandos em cadeia porque nenhum funciona em todo lugar: em
 * containers com /proc restrito o lsof devolve vazio para uma porta que esta
 * claramente ocupada, e o fuser encontra. Parar no primeiro que responder
 * evitaria justamente o caso que motivou isto.
 */
function quemEscuta(porta) {
  if (process.platform === 'win32') {
    const saida = tentar(`netstat -ano -p tcp | findstr LISTENING | findstr :${porta}`);
    const pids = saida
      .split('\n')
      .map((linha) => linha.trim().split(/\s+/).at(-1))
      .filter((pid) => pid && /^\d+$/.test(pid) && pid !== '0');
    return [...new Set(pids)];
  }

  const saidas = [
    tentar(`lsof -ti tcp:${porta} -sTCP:LISTEN`),
    tentar(`fuser -n tcp ${porta}`),
    tentar(`ss -tlnp 'sport = :${porta}'`),
  ];

  const pids = new Set();
  for (const saida of saidas) {
    // O ss traz o pid dentro de users:(("node",pid=123,fd=20)); os outros
    // dois listam numeros soltos.
    for (const achado of saida.matchAll(/pid=(\d+)/g)) pids.add(achado[1]);
    if (!saida.includes('pid=')) {
      for (const token of saida.split(/\s+/)) {
        if (/^\d+$/.test(token)) pids.add(token);
      }
    }
  }
  // O proprio script nao pode se matar.
  pids.delete(String(process.pid));
  return [...pids];
}

function encerrar(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(Number(pid), 'SIGKILL');
    }
    return true;
  } catch {
    return false;
  }
}

let encerrados = 0;
for (const porta of PORTAS) {
  for (const pid of quemEscuta(porta)) {
    if (encerrar(pid)) {
      console.log(`porta ${porta}: processo ${pid} encerrado`);
      encerrados++;
    } else {
      console.log(`porta ${porta}: nao consegui encerrar o processo ${pid}`);
    }
  }
}

console.log(encerrados > 0 ? '\nPortas livres. Rode `pnpm dev`.' : 'Nada rodando nas portas 3000 e 3333.');
