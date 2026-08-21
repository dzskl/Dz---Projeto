'use client';

import { botTokenSchema, type BotPublico, type BotStatus } from '@tg/shared';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Carregando, Erro, Vazio } from '@/components/estados';
import { ApiError, api } from '@/lib/api';

/**
 * Gestao de bots.
 *
 * O token so trafega no cadastro; depois disso a API devolve apenas os quatro
 * ultimos caracteres, entao a tela nunca tem como exibi-lo de novo — nem por
 * engano.
 */

const ROTULO_STATUS: Record<BotStatus, { texto: string; cor: string }> = {
  CONNECTED: { texto: 'Conectado', cor: 'bg-green-500' },
  DISABLED: { texto: 'Desativado', cor: 'bg-zinc-500' },
  INVALID_TOKEN: { texto: 'Token invalido', cor: 'bg-red-500' },
  ERROR: { texto: 'Com erro', cor: 'bg-amber-500' },
};

export default function BotsPage(): ReactNode {
  const [bots, setBots] = useState<BotPublico[]>([]);
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [mensagemErro, setMensagemErro] = useState('');
  const [formAberto, setFormAberto] = useState(false);

  const carregar = useCallback(async (): Promise<void> => {
    setEstado('carregando');
    try {
      const { bots: lista } = await api.bots.listar();
      setBots(lista);
      setEstado('pronto');
    } catch (err) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha ao carregar.');
      setEstado('erro');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Bots</h1>
          <p className="mt-1 text-sm text-suave">
            Cada bot tem a sua propria base de contatos: so recebe mensagem quem deu{' '}
            <code className="rounded bg-borda px-1 py-0.5 text-xs">/start</code> naquele bot.
          </p>
        </div>
        <button
          onClick={() => setFormAberto((v) => !v)}
          className="shrink-0 rounded-md bg-marca px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          {formAberto ? 'Cancelar' : 'Adicionar bot'}
        </button>
      </header>

      {formAberto ? (
        <FormularioBot
          aoCriar={(bot) => {
            setBots((atual) => [bot, ...atual]);
            setFormAberto(false);
          }}
        />
      ) : null}

      {estado === 'carregando' ? <Carregando texto="Carregando bots..." /> : null}

      {estado === 'erro' ? (
        <Erro descricao={mensagemErro} aoTentarNovamente={() => void carregar()} />
      ) : null}

      {estado === 'pronto' && bots.length === 0 ? (
        <Vazio
          titulo="Nenhum bot cadastrado"
          descricao="Crie um bot no @BotFather do Telegram, copie o token e adicione aqui."
        />
      ) : null}

      {estado === 'pronto' && bots.length > 0 ? (
        <ul className="space-y-3">
          {bots.map((bot) => (
            <CartaoBot key={bot.id} bot={bot} aoMudar={carregar} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FormularioBot({ aoCriar }: { aoCriar: (bot: BotPublico) => void }): ReactNode {
  const [token, setToken] = useState('');
  const [apelido, setApelido] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    setErro('');

    // Valida o formato antes de enviar: o mesmo schema que a API usa.
    const validacao = botTokenSchema.safeParse(token);
    if (!validacao.success) {
      setErro(validacao.error.issues[0]?.message ?? 'Token invalido.');
      return;
    }

    setEnviando(true);
    try {
      const { bot } = await api.bots.criar(validacao.data, apelido.trim() || undefined);
      setToken('');
      setApelido('');
      aoCriar(bot);
    } catch (err) {
      if (err instanceof ApiError) {
        setErro(err.fieldError('token') ?? err.message);
      } else {
        setErro('Nao foi possivel adicionar o bot.');
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4 rounded-lg border border-borda bg-superficie p-5">
      <div>
        <label htmlFor="token" className="mb-1.5 block text-sm font-medium">
          Token do BotFather
        </label>
        <input
          id="token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="1234567890:AAH..."
          aria-invalid={Boolean(erro)}
          className="w-full rounded-md border border-borda bg-fundo px-3 py-2 font-mono text-sm outline-none focus:border-marca"
        />
        <p className="mt-1.5 text-xs text-suave">
          O token e cifrado antes de ser gravado e nunca mais e exibido.
        </p>
      </div>

      <div>
        <label htmlFor="apelido" className="mb-1.5 block text-sm font-medium">
          Apelido <span className="font-normal text-suave">(opcional)</span>
        </label>
        <input
          id="apelido"
          type="text"
          value={apelido}
          onChange={(e) => setApelido(e.target.value)}
          placeholder="Como a equipe chama este bot"
          className="w-full rounded-md border border-borda bg-fundo px-3 py-2 text-sm outline-none focus:border-marca"
        />
      </div>

      {erro ? (
        <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {erro}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enviando}
        className="rounded-md bg-marca px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
      >
        {enviando ? 'Validando no Telegram...' : 'Adicionar'}
      </button>
    </form>
  );
}

function CartaoBot({ bot, aoMudar }: { bot: BotPublico; aoMudar: () => void }): ReactNode {
  const [ocupado, setOcupado] = useState(false);
  const status = ROTULO_STATUS[bot.status];

  async function executar(acao: () => Promise<unknown>): Promise<void> {
    setOcupado(true);
    try {
      await acao();
      aoMudar();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="rounded-lg border border-borda bg-superficie p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${status.cor}`} />
            <h2 className="truncate font-medium">{bot.name}</h2>
            <span className="truncate text-sm text-suave">@{bot.username}</span>
          </div>

          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-suave">
            <div className="flex gap-1">
              <dt>Situacao:</dt>
              <dd className="text-texto">{status.texto}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Contatos:</dt>
              <dd className="text-texto">{bot.totalContatos ?? 0}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Grupos:</dt>
              <dd className="text-texto">{bot.totalGrupos ?? 0}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Velocidade:</dt>
              <dd className="text-texto">{bot.ratePerSecond}/s</dd>
            </div>
            <div className="flex gap-1">
              <dt>Token:</dt>
              <dd className="font-mono text-texto">····{bot.tokenHint}</dd>
            </div>
          </dl>

          {bot.lastError ? (
            <p className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
              {bot.lastError}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 gap-2">
          {bot.status !== 'CONNECTED' ? (
            <button
              disabled={ocupado}
              onClick={() => void executar(() => api.bots.reconectar(bot.id))}
              className="rounded-md border border-borda px-3 py-1.5 text-xs hover:bg-borda/40 disabled:opacity-50"
            >
              Reconectar
            </button>
          ) : null}

          <button
            disabled={ocupado}
            onClick={() => void executar(() => api.bots.atualizar(bot.id, { isActive: !bot.isActive }))}
            className="rounded-md border border-borda px-3 py-1.5 text-xs hover:bg-borda/40 disabled:opacity-50"
          >
            {bot.isActive ? 'Desativar' : 'Ativar'}
          </button>

          <button
            disabled={ocupado}
            onClick={() => {
              // Excluir apaga contatos e historico junto: confirmar e o minimo.
              if (!confirm(`Excluir @${bot.username}? Os contatos e o historico deste bot serao apagados.`)) return;
              void executar(() => api.bots.excluir(bot.id));
            }}
            className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/10 disabled:opacity-50"
          >
            Excluir
          </button>
        </div>
      </div>
    </li>
  );
}
