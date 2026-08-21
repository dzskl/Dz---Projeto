import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  // Tema alternado por classe no <html>, e nao por preferencia do sistema:
  // o usuario escolhe e a escolha persiste.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        borda: 'rgb(var(--borda) / <alpha-value>)',
        fundo: 'rgb(var(--fundo) / <alpha-value>)',
        superficie: 'rgb(var(--superficie) / <alpha-value>)',
        texto: 'rgb(var(--texto) / <alpha-value>)',
        suave: 'rgb(var(--suave) / <alpha-value>)',
        marca: 'rgb(var(--marca) / <alpha-value>)',
      },
    },
  },
  plugins: [],
} satisfies Config;
