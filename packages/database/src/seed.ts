import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { prisma } from './index.js';

/**
 * Seed inicial.
 *
 * Cria as contas de dono a partir de SEED_ADMIN_EMAILS (separadas por virgula).
 * Cada conta recebe uma senha aleatoria impressa uma unica vez no terminal — nao
 * ha senha padrao no codigo, para que nunca exista um "admin/admin123" esquecido
 * em producao.
 *
 * Uso:
 *   SEED_ADMIN_EMAILS="a@x.com,b@x.com" pnpm db:seed
 */

/** Parametros do Argon2id (recomendacao OWASP: 19 MiB, 2 iteracoes, paralelismo 1). */
export const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Senha aleatoria legivel, forte o bastante para o primeiro acesso. */
function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

async function main(): Promise<void> {
  const raw = process.env.SEED_ADMIN_EMAILS?.trim();
  if (!raw) {
    throw new Error(
      'Defina SEED_ADMIN_EMAILS com os e-mails dos donos, separados por virgula.\n' +
        'Exemplo: SEED_ADMIN_EMAILS="voce@dominio.com,socio@dominio.com" pnpm db:seed',
    );
  }

  const emails = [...new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const created: Array<{ email: string; password: string }> = [];

  for (const email of emails) {
    const existing = await prisma.admin.findUnique({ where: { email } });
    if (existing) {
      console.log(`· ${email} ja existe — mantido como esta.`);
      continue;
    }

    const password = generatePassword();
    await prisma.admin.create({
      data: {
        email,
        name: email.split('@')[0] ?? email,
        passwordHash: await hash(password, ARGON2_OPTIONS),
        role: 'OWNER',
      },
    });
    created.push({ email, password });
  }

  if (created.length === 0) {
    console.log('\nNenhuma conta nova criada.');
    return;
  }

  console.log('\n' + '='.repeat(62));
  console.log('CONTAS CRIADAS — anote as senhas agora, elas nao sao exibidas de novo');
  console.log('='.repeat(62));
  for (const { email, password } of created) {
    console.log(`  ${email}\n    senha: ${password}\n`);
  }
  console.log('Troque a senha no primeiro acesso.');
  console.log('='.repeat(62) + '\n');
}

main()
  .catch((err: unknown) => {
    console.error('Falha no seed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
