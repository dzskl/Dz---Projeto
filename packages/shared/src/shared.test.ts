import { describe, expect, it } from 'vitest';
import { CAMPAIGN_TRANSITIONS, CampaignStatus, canTransition } from './enums.js';
import { DomainError, ErrorCode } from './errors.js';
import { loginSchema, passwordSchema } from './schemas/auth.js';
import { validate } from './validate.js';

describe('maquina de estados da campanha', () => {
  it('permite pausar e retomar uma campanha em execucao', () => {
    expect(canTransition(CampaignStatus.RUNNING, CampaignStatus.PAUSED)).toBe(true);
    expect(canTransition(CampaignStatus.PAUSED, CampaignStatus.RUNNING)).toBe(true);
  });

  it('nao deixa uma campanha cancelada voltar a rodar', () => {
    // Sem isso, um clique duplo em "cancelar/retomar" poderia reenviar tudo.
    expect(canTransition(CampaignStatus.CANCELLED, CampaignStatus.RUNNING)).toBe(false);
  });

  it('trata COMPLETED e CANCELLED como estados finais', () => {
    expect(CAMPAIGN_TRANSITIONS.COMPLETED).toHaveLength(0);
    expect(CAMPAIGN_TRANSITIONS.CANCELLED).toHaveLength(0);
  });

  it('permite retentar uma campanha que falhou', () => {
    expect(canTransition(CampaignStatus.FAILED, CampaignStatus.RUNNING)).toBe(true);
  });

  it('cobre todos os status conhecidos', () => {
    // Um status novo sem transicoes declaradas quebraria aqui, em vez de virar
    // `undefined.includes(...)` em producao.
    for (const status of Object.values(CampaignStatus)) {
      expect(CAMPAIGN_TRANSITIONS[status]).toBeDefined();
    }
  });
});

describe('validate', () => {
  it('devolve o valor convertido quando os dados sao validos', () => {
    const out = validate(loginSchema, { email: '  PESSOA@Exemplo.COM ', password: 'segredo' });
    // O schema apara espacos e normaliza para minusculas.
    expect(out.email).toBe('pessoa@exemplo.com');
  });

  it('converte falha do zod em DomainError com erros por campo', () => {
    try {
      validate(loginSchema, { email: 'invalido', password: '' });
      throw new Error('deveria ter lancado');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      const domain = err as DomainError;
      expect(domain.code).toBe(ErrorCode.VALIDATION_FAILED);
      const fields = domain.details?.fields as Record<string, string[]>;
      expect(fields.email?.[0]).toBe('E-mail invalido.');
      expect(fields.password?.[0]).toBe('Informe a senha.');
    }
  });
});

describe('politica de senha', () => {
  it('exige pelo menos 12 caracteres', () => {
    expect(passwordSchema.safeParse('curta').success).toBe(false);
    expect(passwordSchema.safeParse('frase-senha-longa').success).toBe(true);
  });

  it('aceita frase com espacos, sem exigir simbolos', () => {
    // A politica premia comprimento em vez de complexidade decorativa.
    expect(passwordSchema.safeParse('tres cavalos azuis').success).toBe(true);
  });
});
