// Execute PostgreSQL/PLpgSQL de verdade sem alterar dependencias da aplicacao.
// npm install --prefix <pasta-temporaria> --no-package-lock @electric-sql/pglite
// node scripts/test-contract-questionnaire-sql.mjs <pasta-temporaria>/node_modules/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.argv[2];
if (!modulePath) throw new Error('Informe o caminho do modulo PGlite instalado em uma pasta temporaria.');
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
const db = new PGlite();
const root = resolve(import.meta.dirname, '..');
const read = name => readFileSync(resolve(root, 'supabase/migrations', name), 'utf8').replaceAll('\r\n', '\n');
const extract = (source, name) => {
  const match = source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n(?:\\$\\$|\\$function\\$);`));
  if (!match) throw new Error(`Funcao ausente: ${name}`);
  return match[0];
};

try {
  await db.exec(readFileSync(resolve(root, 'supabase/tests/contract_questionnaire_schema.sql'), 'utf8'));
  for (const [file, names] of [
    ['20260817234500_reconcile_contract_visits_with_real_tasks.sql', ['normalizar_cliente_visita']],
    ['20260818153000_optimize_contract_visit_sync.sql', ['cliente_rh_chave', 'clientes_rh_relacionados']],
    ['20260818150000_contract_questionnaire_accounting_matrix.sql', ['atividade_e_limpeza_coifa', 'contrato_e_limpeza_coifa']],
    ['20260818033000_scope_contract_visits_by_client_and_activity.sql', ['reconciliar_dia_visita_contratual']],
  ]) {
    for (const name of names) await db.exec(extract(read(file), name));
  }
  await db.exec(readFileSync(resolve(root, 'supabase/tests/contract_questionnaire_seed.sql'), 'utf8'));
  await db.exec("SELECT reconciliar_dia_visita_contratual('Cliente A', current_date - 2)");
  const before = await db.query('SELECT count(*)::int AS n FROM contratos_visitas_execucoes');
  assert.equal(before.rows[0].n, 0, 'O baseline deve reproduzir a visita de coifa perdida pelo espelho sem questionario.');
  console.log('PASS baseline: espelho finalizado sem questionario perde a visita de coifa.');

  await db.exec(read('20260914193000_preserve_contract_questionnaire_evidence.sql'));
  const assertions = readFileSync(resolve(root, 'supabase/tests/contract_questionnaire_evidence.sql'), 'utf8');
  await db.exec(assertions);
  console.log('PASS SQL: deduplicacao, horas, 224444, outros_questionarios, triggers, idempotencia e isolamento cliente/dia.');
} finally {
  await db.close();
}
