-- Corrige a unicidade do opt-out global.
--
-- Em "opt_outs", bot_id NULO significa "opt-out global" (vale para todos os bots).
-- Por padrao o PostgreSQL trata NULL como distinto de NULL em indice unico, entao
-- o indice (bot_id, telegram_user_id) permitia varias linhas de opt-out global
-- para a mesma pessoa — quebrando a garantia de "nunca mais receber".
--
-- NULLS NOT DISTINCT (PostgreSQL 15+) faz os NULOS colidirem entre si, que e o
-- comportamento correto aqui.

DROP INDEX IF EXISTS "opt_outs_bot_id_telegram_user_id_key";

CREATE UNIQUE INDEX "opt_outs_bot_id_telegram_user_id_key"
  ON "opt_outs" ("bot_id", "telegram_user_id") NULLS NOT DISTINCT;
