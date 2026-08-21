'use client';

import type { BotPublico, CampaignStatus, CampanhaPublica, PreviaDoPublico } from '@tg/shared';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Carregando, Erro, Vazio } from '@/components/estados';
import { ApiError, api } from '@/lib/api';

/**
 * Campanhas.
 *
 * A tela mostra a previa do publico ANTES do disparo. Sem isso, a diferenca
 * entre "tenho 5 mil contatos" e "3.100 podem receber" so apareceria depois de
 * comecar — quando ja nao da para voltar atras.
 */

const ROTULO_STATUS: Record<CampaignStatus, { texto: string; cor: string }> = {
  DRAFT: { texto: 'Rascunho', cor: 'bg-zinc-500' },
  SCHEDULED: { texto: 'Agendada', cor: 'bg-blue-500' },
  RUNNING: { texto: 'Em execucao', cor: 'bg-green-500' },
  PAUSED: { texto: 'Pausada', cor: 'bg-amber-500' },
  COMPLETED: { texto: 'Concluida', cor: 'bg-marca' },
  CANCELLED: { texto: 'Cancelada', cor: 'bg-zinc-500' },
  FAILED: { texto: 'Falhou', cor: 'bg-red-500' },
};

/** Acoes oferecidas em cada estado. Espelha a maquina de estados da API. */
const ACOES: Partial<Record<CampaignStatus, Array<{ acao: 'iniciar' | 'pausar' | 'retomar' | 'cancelar'; rotulo: string; destaque?: boolean }>>> = {
  DRAFT: [{ acao: 'iniciar', rotulo: 'Disparar', destaque: true }, { acao: 'cancelar', rotulo: 'Cancelar' }],
  SCHEDULED: [{ acao: 'iniciar', rotulo: 'Disparar agora', destaque: true }, { acao: 'cancelar', rotulo: 'Cancelar' }],
  RUNNING: [{ acao: 'pausar', rotulo: 'Pausar' }, { acao: 'cancelar', rotulo: 'Cancelar' }],
  PAUSED: [{ acao: 'retomar', rotulo: 'Retomar', destaque: true }, { acao: 'cancelar', rotulo: 'Cancelar' }],
  FAILED: [{ acao: 'iniciar', rotulo: 'Tentar de novo' }, { acao: 'cancelar', rotulo: 'Cancelar' }],
};

const formatarDuracao = (segundos: number): string => {
  if (segundos < 60) return `${segundos}s`;
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;
  return `${(min / 60).toFixed(1)} h`;
};

export default function CampanhasPage(): ReactNode {
  const [campanhas, setCampanhas] = useState<CampanhaPublica[]>([]);
  const [bots, setBots] = useState<BotPublico[]>([]);
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [mensagemErro, setMensagemErro] = useState('');
  const [formAberto, setFormAberto] = useState(false);

  const carregar = useCallback(async (): Promise<void> => {
    try {
      const { campanhas: lista } = await api.campanhas.listar();
      setCampanhas(lista);
      setEstado('pronto');
    } catch (err) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha ao carregar.');
      setEstado('erro');
    }
  }, []);

  useEffect(() => {
    api.bots.listar().then((r) => setBots(r.bots)).catch(() => setBots([]));
    void carregar();
  }, [carregar]);

  /**
   * Enquanto houver campanha em execucao, recarrega periodicamente.
   *
   * Os contadores mudam a cada envio; sem isso a tela ficaria parada exibindo
   * numeros velhos. A Fase 5 substitui esta sondagem por tempo real.
   */
  useEffect(() => {
    const rodando = campanhas.some((c) => c.status === 'RUNNING');
    if (!rodando) return;
    const t = setInterval(() => void carregar(), 3_000);
    return () => clearInterval(t);
  }, [campanhas, carregar]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Campanhas</h1>
          <p className="mt-1 text-sm text-suave">
            Envio para a base opt-in de um bot, respeitando o limite de velocidade do Telegram.
          </p>
        </div>
        <button
          onClick={() => setFormAberto((v) => !v)}
          disabled={bots.length === 0}
          title={bots.length === 0 ? 'Cadastre um bot antes' : undefined}
          className="shrink-0 rounded-md bg-marca px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {formAberto ? 'Cancelar' : 'Nova campanha'}
        </button>
      </header>

      {formAberto ? (
        <Formulario
          bots={bots}
          aoCriar={() => {
            setFormAberto(false);
            void carregar();
          }}
        />
      ) : null}

      {estado === 'carregando' ? <Carregando texto="Carregando campanhas..." /> : null}
      {estado === 'erro' ? (
        <Erro descricao={mensagemErro} aoTentarNovamente={() => void carregar()} />
      ) : null}

      {estado === 'pronto' && campanhas.length === 0 ? (
        <Vazio
          titulo="Nenhuma campanha"
          descricao={
            bots.length === 0
              ? 'Cadastre um bot na aba Bots para poder criar campanhas.'
              : 'Crie uma campanha para enviar uma mensagem a base do seu bot.'
          }
        />
      ) : null}

      {campanhas.map((c) => (
        <Cartao key={c.id} campanha={c} aoMudar={carregar} />
      ))}
    </div>
  );
}

function Formulario({
  bots,
  aoCriar,
}: {
  bots: BotPublico[];
  aoCriar: () => void;
}): ReactNode {
  const [nome, setNome] = useState('');
  const [botId, setBotId] = useState(bots[0]?.id ?? '');
  const [texto, setTexto] = useState('');
  const [rate, setRate] = useState(20);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      await api.campanhas.criar({
        nome: nome.trim(),
        botId,
        mensagens: [{ kind: 'TEXT', texto: texto.trim() }],
        ratePerSecond: rate,
      });
      aoCriar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Nao foi possivel criar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4 rounded-lg border border-borda bg-superficie p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="nome" className="mb-1.5 block text-sm font-medium">
            Nome
          </label>
          <input
            id="nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Uso interno, nao aparece para o contato"
            className="w-full rounded-md border border-borda bg-fundo px-3 py-2 text-sm outline-none focus:border-marca"
          />
        </div>
        <div>
          <label htmlFor="bot" className="mb-1.5 block text-sm font-medium">
            Bot
          </label>
          <select
            id="bot"
            value={botId}
            onChange={(e) => setBotId(e.target.value)}
            className="w-full rounded-md border border-borda bg-fundo px-3 py-2 text-sm outline-none focus:border-marca"
          >
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                @{b.username}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="texto" className="mb-1.5 block text-sm font-medium">
          Mensagem
        </label>
        <textarea
          id="texto"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={4}
          maxLength={4096}
          placeholder="O que sera enviado a cada contato"
          className="w-full resize-y rounded-md border border-borda bg-fundo px-3 py-2 text-sm outline-none focus:border-marca"
        />
        <p className="mt-1 text-xs text-suave">{texto.length}/4096 caracteres</p>
      </div>

      <div>
        <label htmlFor="rate" className="mb-1.5 block text-sm font-medium">
          Velocidade: {rate} mensagens por segundo
        </label>
        <input
          id="rate"
          type="range"
          min={1}
          max={30}
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          className="w-full accent-[rgb(var(--marca))]"
        />
        <p className="mt-1 text-xs text-suave">
          O Telegram limita perto de 30/s por bot. Acima disso ele passa a recusar envios e pode
          restringir o bot por horas.
        </p>
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
        {enviando ? 'Criando...' : 'Criar rascunho'}
      </button>
    </form>
  );
}

function Cartao({
  campanha,
  aoMudar,
}: {
  campanha: CampanhaPublica;
  aoMudar: () => void;
}): ReactNode {
  const [previa, setPrevia] = useState<PreviaDoPublico | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const status = ROTULO_STATUS[campanha.status];
  const acoes = ACOES[campanha.status] ?? [];

  // A previa so interessa antes do disparo; depois valem os numeros reais.
  useEffect(() => {
    if (campanha.status !== 'DRAFT' && campanha.status !== 'SCHEDULED') return;
    api.campanhas
      .previa(campanha.id)
      .then(setPrevia)
      .catch(() => setPrevia(null));
  }, [campanha.id, campanha.status]);

  async function executar(acao: 'iniciar' | 'pausar' | 'retomar' | 'cancelar'): Promise<void> {
    if (acao === 'iniciar' && previa) {
      const ok = confirm(
        `Disparar para ${previa.elegiveis} ${previa.elegiveis === 1 ? 'contato' : 'contatos'}?\n` +
          `Tempo estimado: ${formatarDuracao(previa.duracaoEstimadaSegundos)}.`,
      );
      if (!ok) return;
    }
    if (acao === 'cancelar' && !confirm('Cancelar esta campanha? Nao da para retomar depois.')) {
      return;
    }

    setOcupado(true);
    setErro('');
    try {
      await api.campanhas.acao(campanha.id, acao);
      aoMudar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha na acao.');
    } finally {
      setOcupado(false);
    }
  }

  const processados =
    campanha.enviados + campanha.falhas + campanha.bloqueados + campanha.ignorados;
  const progresso =
    campanha.totalDestinatarios > 0
      ? Math.round((processados / campanha.totalDestinatarios) * 100)
      : 0;

  return (
    <article className="rounded-lg border border-borda bg-superficie p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${status.cor}`} />
            <h2 className="truncate font-medium">{campanha.nome}</h2>
            <span className="text-sm text-suave">@{campanha.bot.username}</span>
          </div>
          <p className="mt-1 text-xs text-suave">
            {status.texto} · {campanha.ratePerSecond}/s
            {previa ? ` · ${previa.elegiveis} de ${previa.totalNoBot} podem receber` : ''}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          {acoes.map((a) => (
            <button
              key={a.acao}
              disabled={ocupado}
              onClick={() => void executar(a.acao)}
              className={
                a.destaque
                  ? 'rounded-md bg-marca px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50'
                  : 'rounded-md border border-borda px-3 py-1.5 text-xs hover:bg-borda/40 disabled:opacity-50'
              }
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      </div>

      {campanha.mensagens[0]?.texto ? (
        <p className="mt-3 line-clamp-2 rounded bg-fundo px-3 py-2 text-sm text-suave">
          {campanha.mensagens[0].texto}
        </p>
      ) : null}

      {campanha.totalDestinatarios > 0 ? (
        <div className="mt-3 space-y-2">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-borda"
            role="progressbar"
            aria-valuenow={progresso}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progresso do envio"
          >
            <div
              className="h-full bg-marca transition-all"
              style={{ width: `${progresso}%` }}
            />
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-suave">
            <div className="flex gap-1">
              <dt>Total:</dt>
              <dd className="text-texto">{campanha.totalDestinatarios}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Enviados:</dt>
              <dd className="text-green-600 dark:text-green-400">{campanha.enviados}</dd>
            </div>
            {campanha.bloqueados > 0 ? (
              <div className="flex gap-1">
                <dt>Bloquearam:</dt>
                <dd className="text-texto">{campanha.bloqueados}</dd>
              </div>
            ) : null}
            {campanha.falhas > 0 ? (
              <div className="flex gap-1">
                <dt>Falhas:</dt>
                <dd className="text-red-500">{campanha.falhas}</dd>
              </div>
            ) : null}
            {campanha.ignorados > 0 ? (
              <div className="flex gap-1">
                <dt>Ignorados:</dt>
                <dd className="text-texto">{campanha.ignorados}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      {erro ? (
        <p role="alert" className="mt-3 rounded bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {erro}
        </p>
      ) : null}
    </article>
  );
}
