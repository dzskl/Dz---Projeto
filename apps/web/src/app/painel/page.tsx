'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { Esqueleto, Vazio } from '@/components/estados';
import { useSessao } from '@/components/sessao';

/**
 * Visao geral.
 *
 * Os numeros de bots, contatos e campanhas so existem a partir da Fase 2, entao
 * a tela mostra o que ja e real (estado do servico) e diz claramente que o resto
 * ainda nao foi construido — em vez de exibir zeros que parecem dados.
 */
export default function VisaoGeral(): ReactNode {
  const { admin } = useSessao();
  const [saude, setSaude] = useState<{ ok: boolean; latencyMs: number } | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    api
      .saude()
      .then((r) => setSaude(r.database))
      .catch(() => setSaude(null))
      .finally(() => setCarregando(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="text-xl font-semibold">Ola, {admin.name}</h1>
        <p className="mt-1 text-sm text-suave">
          Este e o painel da plataforma. As secoes de bots, contatos e campanhas entram nas
          proximas fases.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-medium text-suave">Estado do servico</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-borda bg-superficie p-4">
            <p className="text-xs text-suave">API</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-medium">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Respondendo
            </p>
          </div>

          <div className="rounded-lg border border-borda bg-superficie p-4">
            <p className="text-xs text-suave">Banco de dados</p>
            {carregando ? (
              <Esqueleto className="mt-2 h-5 w-32" />
            ) : (
              <p className="mt-1 flex items-center gap-2 text-sm font-medium">
                <span
                  className={`h-2 w-2 rounded-full ${saude?.ok ? 'bg-green-500' : 'bg-red-500'}`}
                />
                {saude?.ok ? `Conectado (${saude.latencyMs} ms)` : 'Indisponivel'}
              </p>
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-suave">Atividade</h2>
        <Vazio
          titulo="Nada para mostrar ainda"
          descricao="Assim que houver bots conectados e campanhas em execucao, o resumo aparece aqui."
        />
      </section>
    </div>
  );
}
