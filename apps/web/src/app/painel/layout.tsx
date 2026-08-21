'use client';

import type { ReactNode } from 'react';
import { Navegacao } from '@/components/navegacao';
import { ProvedorSessao } from '@/components/sessao';

/**
 * Casca do painel.
 *
 * Tudo aqui dentro exige sessao valida: o ProvedorSessao verifica antes de
 * renderizar qualquer conteudo e redireciona para o login se nao houver.
 */
export default function PainelLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <ProvedorSessao>
      <div className="flex min-h-screen flex-col md:flex-row">
        <Navegacao />
        <main className="flex-1 overflow-x-hidden px-4 py-6 md:px-8">{children}</main>
      </div>
    </ProvedorSessao>
  );
}
