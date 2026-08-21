'use client';

import type { AdminPublic } from '@tg/shared';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api } from '@/lib/api';
import { Carregando, Erro } from './estados';

/**
 * Sessao do painel.
 *
 * A verificacao e feita no cliente porque o cookie e httpOnly: o JavaScript nao
 * le o token, apenas pergunta a API quem esta logado. Enquanto a resposta nao
 * chega, nada do painel e renderizado — evita exibir a interface por um instante
 * para quem nao esta autenticado.
 */

interface Sessao {
  admin: AdminPublic;
  sair: () => Promise<void>;
}

const SessaoContext = createContext<Sessao | null>(null);

export function useSessao(): Sessao {
  const contexto = useContext(SessaoContext);
  if (!contexto) throw new Error('useSessao precisa estar dentro de <ProvedorSessao>.');
  return contexto;
}

export function ProvedorSessao({ children }: { children: ReactNode }): ReactNode {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminPublic | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [mensagem, setMensagem] = useState('');

  async function verificar(): Promise<void> {
    setEstado('carregando');
    try {
      const { admin: encontrado } = await api.eu();
      setAdmin(encontrado);
      setEstado('pronto');
    } catch (err) {
      // 401 e o fluxo normal de quem nao esta logado: nao e erro de tela, e
      // redirecionamento. Falha de rede, sim, precisa ser mostrada.
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setMensagem(err instanceof Error ? err.message : 'Erro ao verificar a sessao.');
      setEstado('erro');
    }
  }

  useEffect(() => {
    void verificar();
    // Executa uma vez ao montar; `router` e estavel entre renderizacoes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sair(): Promise<void> {
    try {
      await api.logout();
    } finally {
      // Mesmo que a chamada falhe, tirar o usuario da tela e o comportamento
      // esperado de um "Sair".
      router.replace('/login');
    }
  }

  if (estado === 'carregando') return <Carregando texto="Verificando acesso..." />;
  if (estado === 'erro') {
    return (
      <div className="mx-auto max-w-md p-8">
        <Erro descricao={mensagem} aoTentarNovamente={() => void verificar()} />
      </div>
    );
  }
  if (!admin) return null;

  return <SessaoContext.Provider value={{ admin, sair }}>{children}</SessaoContext.Provider>;
}
