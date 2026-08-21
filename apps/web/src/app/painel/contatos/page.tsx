'use client';

import type { BotPublico, ContatoPublico, OptOutPublico, PaginaDeContatos } from '@tg/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Carregando, Erro, Vazio } from '@/components/estados';
import { api } from '@/lib/api';

/**
 * Contatos e opt-outs.
 *
 * A coluna "Pode receber" e o que importa na pratica: um contato so entra numa
 * campanha se estiver ativo, tiver conversa privada aberta e nao estiver na
 * lista de opt-out. Mostrar isso explicitamente evita a surpresa de uma campanha
 * alcancar menos gente do que o total sugeria.
 */

const ROTULO_STATUS: Record<string, string> = {
  ACTIVE: 'Ativo',
  BLOCKED_BOT: 'Bloqueou o bot',
  DEACTIVATED: 'Conta desativada',
  UNSUBSCRIBED: 'Saiu da lista',
};

const ROTULO_ORIGEM: Record<string, string> = {
  START_COMMAND: '/start',
  PRIVATE_MESSAGE: 'Mensagem',
  CALLBACK_QUERY: 'Botao',
  MANUAL: 'Manual',
};

const ROTULO_MOTIVO: Record<string, string> = {
  USER_REQUEST: 'Pediu para sair',
  BLOCKED_BOT: 'Bloqueou o bot',
  DEACTIVATED: 'Conta desativada',
  MANUAL: 'Decisao administrativa',
};

const formatarData = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export default function ContatosPage(): ReactNode {
  const [aba, setAba] = useState<'contatos' | 'optouts'>('contatos');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Contatos</h1>
        <p className="mt-1 text-sm text-suave">
          Pessoas que interagiram com os seus bots. A base cresce sozinha conforme elas mandam{' '}
          <code className="rounded bg-borda px-1 py-0.5 text-xs">/start</code>.
        </p>
      </header>

      <div className="flex gap-1 border-b border-borda">
        {(
          [
            ['contatos', 'Contatos'],
            ['optouts', 'Opt-outs'],
          ] as const
        ).map(([chave, rotulo]) => (
          <button
            key={chave}
            onClick={() => setAba(chave)}
            aria-current={aba === chave ? 'page' : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
              aba === chave
                ? 'border-marca font-medium text-marca'
                : 'border-transparent text-suave hover:text-texto'
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aba === 'contatos' ? <AbaContatos /> : <AbaOptOuts />}
    </div>
  );
}

function AbaContatos(): ReactNode {
  const [dados, setDados] = useState<PaginaDeContatos | null>(null);
  const [bots, setBots] = useState<BotPublico[]>([]);
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [mensagemErro, setMensagemErro] = useState('');
  const [botId, setBotId] = useState('');
  const [status, setStatus] = useState('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);

  useEffect(() => {
    api.bots
      .listar()
      .then((r) => setBots(r.bots))
      .catch(() => setBots([]));
  }, []);

  const carregar = useCallback(async (): Promise<void> => {
    setEstado('carregando');
    try {
      setDados(await api.contatos.listar({ botId, status, busca, pagina }));
      setEstado('pronto');
    } catch (err) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha ao carregar.');
      setEstado('erro');
    }
  }, [botId, status, busca, pagina]);

  useEffect(() => {
    // Atraso na digitacao: sem isso cada tecla vira uma requisicao.
    const t = setTimeout(() => void carregar(), 250);
    return () => clearTimeout(t);
  }, [carregar]);

  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.porPagina)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setPagina(1);
          }}
          placeholder="Buscar por nome ou @username"
          aria-label="Buscar contatos"
          className="min-w-[200px] flex-1 rounded-md border border-borda bg-superficie px-3 py-2 text-sm outline-none focus:border-marca"
        />
        <select
          value={botId}
          onChange={(e) => {
            setBotId(e.target.value);
            setPagina(1);
          }}
          aria-label="Filtrar por bot"
          className="rounded-md border border-borda bg-superficie px-3 py-2 text-sm outline-none focus:border-marca"
        >
          <option value="">Todos os bots</option>
          {bots.map((b) => (
            <option key={b.id} value={b.id}>
              @{b.username}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPagina(1);
          }}
          aria-label="Filtrar por situacao"
          className="rounded-md border border-borda bg-superficie px-3 py-2 text-sm outline-none focus:border-marca"
        >
          <option value="">Todas as situacoes</option>
          {Object.entries(ROTULO_STATUS).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </select>
      </div>

      {dados && estado === 'pronto' ? (
        <div className="flex gap-3 text-sm">
          <span className="rounded-md border border-borda bg-superficie px-3 py-1.5">
            {dados.total} {dados.total === 1 ? 'contato' : 'contatos'}
          </span>
          <span className="rounded-md border border-green-500/30 bg-green-500/5 px-3 py-1.5 text-green-600 dark:text-green-400">
            {dados.totalElegiveis} podem receber
          </span>
        </div>
      ) : null}

      {estado === 'carregando' ? <Carregando texto="Carregando contatos..." /> : null}
      {estado === 'erro' ? (
        <Erro descricao={mensagemErro} aoTentarNovamente={() => void carregar()} />
      ) : null}

      {estado === 'pronto' && dados?.contatos.length === 0 ? (
        <Vazio
          titulo="Nenhum contato"
          descricao="Os contatos aparecem aqui quando alguem envia /start para um dos seus bots."
        />
      ) : null}

      {estado === 'pronto' && dados && dados.contatos.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-borda">
            <table className="w-full text-sm">
              <thead className="bg-superficie text-left text-xs text-suave">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Pessoa</th>
                  <th className="px-4 py-2.5 font-medium">Bot</th>
                  <th className="px-4 py-2.5 font-medium">Situacao</th>
                  <th className="px-4 py-2.5 font-medium">Origem</th>
                  <th className="px-4 py-2.5 font-medium">Ultima interacao</th>
                  <th className="px-4 py-2.5 font-medium">Pode receber</th>
                </tr>
              </thead>
              <tbody>
                {dados.contatos.map((c) => (
                  <LinhaContato key={c.id} contato={c} />
                ))}
              </tbody>
            </table>
          </div>

          {totalPaginas > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <button
                disabled={pagina <= 1}
                onClick={() => setPagina((p) => p - 1)}
                className="rounded-md border border-borda px-3 py-1.5 disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="text-suave">
                Pagina {pagina} de {totalPaginas}
              </span>
              <button
                disabled={pagina >= totalPaginas}
                onClick={() => setPagina((p) => p + 1)}
                className="rounded-md border border-borda px-3 py-1.5 disabled:opacity-40"
              >
                Proxima
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function LinhaContato({ contato }: { contato: ContatoPublico }): ReactNode {
  return (
    <tr className="border-t border-borda">
      <td className="px-4 py-2.5">
        <div className="font-medium">{contato.nome}</div>
        {contato.username ? (
          <div className="text-xs text-suave">@{contato.username}</div>
        ) : null}
      </td>
      <td className="px-4 py-2.5 text-suave">@{contato.bot.username}</td>
      <td className="px-4 py-2.5">{ROTULO_STATUS[contato.status] ?? contato.status}</td>
      <td className="px-4 py-2.5">
        <span className="text-suave">
          {ROTULO_ORIGEM[contato.origemConsentimento] ?? contato.origemConsentimento}
        </span>
        {contato.origemCampanha ? (
          <div className="text-xs text-suave">via {contato.origemCampanha}</div>
        ) : null}
      </td>
      <td className="px-4 py-2.5 text-suave">{formatarData(contato.ultimaInteracaoEm)}</td>
      <td className="px-4 py-2.5">
        {contato.podeReceber ? (
          <span className="text-green-600 dark:text-green-400">Sim</span>
        ) : (
          <span className="text-suave">Nao</span>
        )}
      </td>
    </tr>
  );
}

function AbaOptOuts(): ReactNode {
  const [lista, setLista] = useState<OptOutPublico[]>([]);
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [mensagemErro, setMensagemErro] = useState('');

  const carregar = useCallback(async (): Promise<void> => {
    setEstado('carregando');
    try {
      const { optOuts } = await api.contatos.optOuts();
      setLista(optOuts);
      setEstado('pronto');
    } catch (err) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha ao carregar.');
      setEstado('erro');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function remover(id: string): Promise<void> {
    if (
      !confirm(
        'Remover este opt-out? A pessoa nao volta a receber automaticamente — ela precisa enviar /start.',
      )
    )
      return;
    await api.contatos.removerOptOut(id);
    void carregar();
  }

  if (estado === 'carregando') return <Carregando texto="Carregando opt-outs..." />;
  if (estado === 'erro')
    return <Erro descricao={mensagemErro} aoTentarNovamente={() => void carregar()} />;

  if (lista.length === 0) {
    return (
      <Vazio
        titulo="Nenhum opt-out"
        descricao="Quem enviar /stop ou bloquear o bot aparece aqui automaticamente."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-borda">
      <table className="w-full text-sm">
        <thead className="bg-superficie text-left text-xs text-suave">
          <tr>
            <th className="px-4 py-2.5 font-medium">Pessoa</th>
            <th className="px-4 py-2.5 font-medium">Alcance</th>
            <th className="px-4 py-2.5 font-medium">Motivo</th>
            <th className="px-4 py-2.5 font-medium">Desde</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {lista.map((o) => (
            <tr key={o.id} className="border-t border-borda">
              <td className="px-4 py-2.5">
                <div className="font-medium">{o.nome}</div>
                {o.username ? <div className="text-xs text-suave">@{o.username}</div> : null}
              </td>
              <td className="px-4 py-2.5 text-suave">
                {o.botUsername ? `@${o.botUsername}` : 'Todos os bots'}
              </td>
              <td className="px-4 py-2.5">
                {ROTULO_MOTIVO[o.motivo] ?? o.motivo}
                {o.observacao ? <div className="text-xs text-suave">{o.observacao}</div> : null}
              </td>
              <td className="px-4 py-2.5 text-suave">{formatarData(o.criadoEm)}</td>
              <td className="px-4 py-2.5 text-right">
                <button
                  onClick={() => void remover(o.id)}
                  className="rounded-md border border-borda px-3 py-1 text-xs hover:bg-borda/40"
                >
                  Remover
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
