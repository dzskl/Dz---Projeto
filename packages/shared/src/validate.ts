import { ZodError, type ZodSchema } from 'zod';
import { DomainError, ErrorCode } from './errors.js';

/**
 * Valida um valor contra um schema e devolve um erro de dominio em caso de falha.
 *
 * A validacao mora aqui, junto dos schemas, de proposito. Se quem chama fizesse
 * `catch (e) { if (e instanceof ZodError) ... }`, o teste falharia de forma
 * silenciosa: o zod publica pontos de entrada separados para CommonJS
 * (`index.cjs`) e ESM (`index.js`), entao um pacote que faz `require` e outro
 * que faz `import` carregam copias diferentes do modulo — e `instanceof` nao
 * atravessa essa fronteira, mesmo havendo uma unica versao instalada.
 *
 * Concentrando a checagem neste arquivo, o `instanceof` sempre compara classes
 * da mesma instancia do modulo.
 */
export function validate<T>(schema: ZodSchema<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      // Agrupa as mensagens por campo para o formulario exibir cada erro no seu
      // proprio input.
      const fields: Record<string, string[]> = {};
      for (const issue of err.issues) {
        const key = issue.path.join('.') || '_';
        (fields[key] ??= []).push(issue.message);
      }
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Verifique os campos informados.', {
        fields,
      });
    }
    throw err;
  }
}
