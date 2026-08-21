import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Plataforma Telegram',
  description: 'Gestao de bots, contatos e campanhas no Telegram',
};

/**
 * Script aplicado antes da primeira pintura.
 *
 * Sem isso a pagina renderiza no tema claro e so troca para o escuro depois da
 * hidratacao — o "flash" branco que incomoda quem usa tema escuro.
 */
const APLICAR_TEMA = `
(function () {
  try {
    var salvo = localStorage.getItem('tema');
    var escuro = salvo ? salvo === 'escuro'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (escuro) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APLICAR_TEMA }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
