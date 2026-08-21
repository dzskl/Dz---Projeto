'use client';

import { loginSchema } from '@tg/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api } from '@/lib/api';

/**
 * Tela de login.
 *
 * Valida com o mesmo schema Zod usado pela API (@tg/shared): as regras existem
 * num lugar so, entao o formulario nunca aceita algo que o servidor recusaria —
 * nem o contrario.
 */
export default function LoginPage(): ReactNode {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    setErros({});
    setErroGeral('');

    const validacao = loginSchema.safeParse({ email, password: senha });
    if (!validacao.success) {
      const campos: Record<string, string> = {};
      for (const issue of validacao.error.issues) {
        const chave = issue.path[0];
        if (typeof chave === 'string' && !campos[chave]) campos[chave] = issue.message;
      }
      setErros(campos);
      return;
    }

    setEnviando(true);
    try {
      await api.login(validacao.data.email, validacao.data.password);
      router.replace('/painel');
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        const campos: Record<string, string> = {};
        for (const [nome, mensagens] of Object.entries(err.fields)) {
          if (mensagens[0]) campos[nome] = mensagens[0];
        }
        setErros(campos);
      } else {
        setErroGeral(err instanceof Error ? err.message : 'Nao foi possivel entrar.');
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold">Plataforma Telegram</h1>
          <p className="mt-1 text-sm text-suave">Acesso restrito aos administradores</p>
        </div>

        <form
          onSubmit={enviar}
          className="space-y-4 rounded-xl border border-borda bg-superficie p-6"
          noValidate
        >
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(erros.email)}
              aria-describedby={erros.email ? 'erro-email' : undefined}
              className="w-full rounded-md border border-borda bg-fundo px-3 py-2 text-sm outline-none focus:border-marca"
            />
            {erros.email ? (
              <p id="erro-email" className="mt-1.5 text-xs text-red-500">
                {erros.email}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="senha" className="mb-1.5 block text-sm font-medium">
              Senha
            </label>
            <input
              id="senha"
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              aria-invalid={Boolean(erros.password)}
              aria-describedby={erros.password ? 'erro-senha' : undefined}
              className="w-full rounded-md border border-borda bg-fundo px-3 py-2 text-sm outline-none focus:border-marca"
            />
            {erros.password ? (
              <p id="erro-senha" className="mt-1.5 text-xs text-red-500">
                {erros.password}
              </p>
            ) : null}
          </div>

          {erroGeral ? (
            <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {erroGeral}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-md bg-marca px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {enviando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  );
}
