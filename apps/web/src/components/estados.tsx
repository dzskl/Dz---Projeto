import type { ReactNode } from 'react';

/**
 * Estados de tela reutilizaveis.
 *
 * Carregando, vazio e erro aparecem em toda listagem do painel. Concentra-los
 * aqui evita que cada tela invente a sua propria versao e o produto fique
 * inconsistente.
 */

/** Esqueleto cinza durante o carregamento. */
export function Esqueleto({ className = '' }: { className?: string }): ReactNode {
  return <div className={`animate-pulse rounded bg-borda ${className}`} />;
}

export function Carregando({ texto = 'Carregando...' }: { texto?: string }): ReactNode {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-16 text-suave"
      // Leitores de tela anunciam a mudanca sem roubar o foco.
      role="status"
      aria-live="polite"
    >
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-borda border-t-marca" />
      <span className="text-sm">{texto}</span>
    </div>
  );
}

export function Vazio({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao: string;
  acao?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-borda py-16 text-center">
      <h3 className="text-base font-medium">{titulo}</h3>
      <p className="max-w-sm text-sm text-suave">{descricao}</p>
      {acao ? <div className="mt-3">{acao}</div> : null}
    </div>
  );
}

export function Erro({
  titulo = 'Algo deu errado',
  descricao,
  aoTentarNovamente,
}: {
  titulo?: string;
  descricao: string;
  aoTentarNovamente?: () => void;
}): ReactNode {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 py-16 text-center"
      role="alert"
    >
      <h3 className="text-base font-medium text-red-500">{titulo}</h3>
      <p className="max-w-sm text-sm text-suave">{descricao}</p>
      {aoTentarNovamente ? (
        <button
          onClick={aoTentarNovamente}
          className="mt-3 rounded-md border border-borda px-3 py-1.5 text-sm hover:bg-superficie"
        >
          Tentar novamente
        </button>
      ) : null}
    </div>
  );
}
