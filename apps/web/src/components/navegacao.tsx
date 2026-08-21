'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { BotaoTema } from './tema';
import { useSessao } from './sessao';

/**
 * Navegacao lateral do painel.
 *
 * As secoes ainda nao construidas aparecem desabilitadas, com a fase em que
 * entram. E mais honesto do que esconde-las: deixa claro o que existe e o que
 * esta por vir, em vez de dar a impressao de que o produto esta completo.
 */

interface Item {
  href: string;
  rotulo: string;
  icone: ReactNode;
  disponivel: boolean;
  fase?: string;
}

const icone = (d: string): ReactNode => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ITENS: Item[] = [
  {
    href: '/painel',
    rotulo: 'Visao geral',
    icone: icone('M3 12h7V3H3zM14 21h7v-9h-7zM14 8h7V3h-7zM3 21h7v-5H3z'),
    disponivel: true,
  },
  {
    href: '/painel/bots',
    rotulo: 'Bots',
    icone: icone('M12 8V4m-4 4h8a2 2 0 012 2v8a2 2 0 01-2 2H8a2 2 0 01-2-2v-8a2 2 0 012-2zm1 5h.01M15 13h.01'),
    disponivel: false,
    fase: 'Fase 2',
  },
  {
    href: '/painel/contatos',
    rotulo: 'Contatos',
    icone: icone('M17 20v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 108 0 4 4 0 00-8 0'),
    disponivel: false,
    fase: 'Fase 3',
  },
  {
    href: '/painel/campanhas',
    rotulo: 'Campanhas',
    icone: icone('M3 11l18-8-8 18-2-7-8-3z'),
    disponivel: false,
    fase: 'Fase 4',
  },
  {
    href: '/painel/midia',
    rotulo: 'Midia',
    icone: icone('M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6'),
    disponivel: false,
    fase: 'Fase 4',
  },
];

export function Navegacao(): ReactNode {
  const caminho = usePathname();
  const { admin, sair } = useSessao();
  const [aberto, setAberto] = useState(false);

  const conteudo = (
    <nav className="flex h-full flex-col gap-1 p-3">
      {ITENS.map((item) => {
        const ativo = caminho === item.href;

        if (!item.disponivel) {
          return (
            <span
              key={item.href}
              className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-suave/50"
              title={`Disponivel na ${item.fase}`}
            >
              {item.icone}
              <span className="flex-1">{item.rotulo}</span>
              <span className="rounded bg-borda px-1.5 py-0.5 text-[10px] font-medium text-suave">
                {item.fase}
              </span>
            </span>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setAberto(false)}
            aria-current={ativo ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
              ativo ? 'bg-marca/10 font-medium text-marca' : 'text-suave hover:bg-borda/40 hover:text-texto'
            }`}
          >
            {item.icone}
            {item.rotulo}
          </Link>
        );
      })}

      <div className="mt-auto space-y-2 border-t border-borda pt-3">
        <div className="px-3">
          <p className="truncate text-sm font-medium">{admin.name}</p>
          <p className="truncate text-xs text-suave">{admin.email}</p>
          <span className="mt-1 inline-block rounded bg-borda px-1.5 py-0.5 text-[10px] font-medium text-suave">
            {admin.role}
          </span>
        </div>
        <button
          onClick={() => void sair()}
          className="w-full rounded-md px-3 py-2 text-left text-sm text-suave transition hover:bg-borda/40 hover:text-texto"
        >
          Sair
        </button>
      </div>
    </nav>
  );

  return (
    <>
      {/* Barra superior no celular */}
      <div className="flex items-center justify-between border-b border-borda bg-superficie px-4 py-3 md:hidden">
        <button
          onClick={() => setAberto((v) => !v)}
          aria-label="Abrir menu"
          aria-expanded={aberto}
          className="rounded-md border border-borda p-1.5 text-suave"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
          </svg>
        </button>
        <span className="text-sm font-semibold">Plataforma Telegram</span>
        <BotaoTema />
      </div>

      {aberto ? (
        <div className="border-b border-borda bg-superficie md:hidden">{conteudo}</div>
      ) : null}

      {/* Coluna fixa a partir de md */}
      <aside className="hidden w-60 shrink-0 border-r border-borda bg-superficie md:flex md:flex-col">
        <div className="flex items-center justify-between border-b border-borda px-4 py-3">
          <span className="text-sm font-semibold">Plataforma Telegram</span>
          <BotaoTema />
        </div>
        {conteudo}
      </aside>
    </>
  );
}
