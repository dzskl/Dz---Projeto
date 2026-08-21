import type { AdminPublic, ApiErrorBody, BotPublico, ErrorCode } from '@tg/shared';

/**
 * Cliente HTTP do painel.
 *
 * Todas as chamadas usam `credentials: 'include'` porque a sessao vive num
 * cookie httpOnly — o JavaScript nao consegue (nem precisa) ler o token, ele so
 * pede ao navegador que o envie.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

/** Erro vindo da API, ja com o codigo de dominio preservado. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Erros de campo do formulario, quando a API devolveu VALIDATION_FAILED. */
  fieldError(name: string): string | undefined {
    return this.fields?.[name]?.[0];
  }
}

async function requisicao<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;

  try {
    resposta = await fetch(`${BASE}/api${caminho}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    // Falha de rede nao tem corpo nem status: e preciso distinguir de erro da
    // API para a tela dizer "sem conexao" em vez de "erro interno".
    throw new ApiError('NETWORK', 'Nao foi possivel falar com o servidor.', 0);
  }

  if (resposta.status === 204) return undefined as T;

  const corpo: unknown = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    const erro = (corpo as ApiErrorBody | null)?.error;
    throw new ApiError(
      erro?.code ?? 'INTERNAL',
      erro?.message ?? 'Erro inesperado.',
      resposta.status,
      erro?.details?.fields as Record<string, string[]> | undefined,
    );
  }

  return corpo as T;
}

export const api = {
  login: (email: string, password: string) =>
    requisicao<{ admin: AdminPublic }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () => requisicao<void>('/auth/logout', { method: 'POST' }),

  eu: () => requisicao<{ admin: AdminPublic }>('/auth/me'),

  saude: () =>
    requisicao<{ status: string; database: { ok: boolean; latencyMs: number } }>('/health'),

  bots: {
    listar: () => requisicao<{ bots: BotPublico[] }>('/bots'),

    criar: (token: string, apelido?: string) =>
      requisicao<{ bot: BotPublico }>('/bots', {
        method: 'POST',
        body: JSON.stringify({ token, ...(apelido ? { apelido } : {}) }),
      }),

    atualizar: (id: string, dados: { isActive?: boolean; ratePerSecond?: number; apelido?: string }) =>
      requisicao<{ bot: BotPublico }>(`/bots/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(dados),
      }),

    reconectar: (id: string) =>
      requisicao<{ bot: BotPublico }>(`/bots/${id}/reconectar`, { method: 'POST' }),

    excluir: (id: string) => requisicao<void>(`/bots/${id}`, { method: 'DELETE' }),
  },
};
