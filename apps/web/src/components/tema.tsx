'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * Alternador de tema.
 *
 * A escolha fica no localStorage; sem escolha, segue a preferencia do sistema.
 * O script em layout.tsx aplica a classe antes da primeira pintura para nao
 * haver piscada de tema claro.
 */
export function BotaoTema(): ReactNode {
  const [escuro, setEscuro] = useState<boolean | null>(null);

  useEffect(() => {
    setEscuro(document.documentElement.classList.contains('dark'));
  }, []);

  function alternar(): void {
    const proximo = !escuro;
    setEscuro(proximo);
    document.documentElement.classList.toggle('dark', proximo);
    localStorage.setItem('tema', proximo ? 'escuro' : 'claro');
  }

  // Antes da hidratacao nao sabemos o tema; renderizar um placeholder do mesmo
  // tamanho evita deslocamento do layout.
  if (escuro === null) return <span className="h-8 w-8" aria-hidden />;

  return (
    <button
      onClick={alternar}
      className="rounded-md border border-borda p-1.5 text-suave hover:text-texto"
      aria-label={escuro ? 'Usar tema claro' : 'Usar tema escuro'}
      title={escuro ? 'Tema claro' : 'Tema escuro'}
    >
      {escuro ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
