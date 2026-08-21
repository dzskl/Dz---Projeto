import { ZodError, type TypeOf, type ZodTypeAny } from 'zod';
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
 *
 * O generico e o proprio schema (e nao o tipo de saida) para que o retorno seja
 * `TypeOf<S>`, ja com `.default()` e `.coerce` aplicados. Tipando por
 * `ZodSchema<T>`, o TypeScript escolhia o tipo de ENTRADA e campos com valor
 * padrao continuavam opcionais depois da validacao.
 */
export function validate<S extends ZodTypeAny>(schema: S, value: unknown): TypeOf<S> {
  try {
    return schema.parse(value) as TypeOf<S>;
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
