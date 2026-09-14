// Usa o mesmo modulo PGlite externo do teste de questionarios, sem acessar producao.
// node scripts/test-contract-obsolete-progress-sql.mjs <pasta-temporaria>/node_modules/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.argv[2];
if (!modulePath) throw new Error('Informe o caminho do modulo PGlite instalado em uma pasta temporaria.');
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
const db = new PGlite();
const root = resolve(import.meta.dirname, '..');
const read = (folder, name) => readFileSync(resolve(root, 'supabase', folder, name), 'utf8').replaceAll('\r\n', '\n');
const extract = (source, name) => {
  const match = source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n(?:\\$\\$|\\$function\\$);`));
  if (!match) throw new Error(`Funcao ausente: ${name}`);
  return match[0];
};
const trigger = (source, name) => {
  const match = source.match(new RegExp(`CREATE TRIGGER ${name}\\b[\\s\\S]*?;`));
  if (!match) throw new Error(`Trigger ausente: ${name}`);
  return match[0];
};

try {
  await db.exec(read('tests', 'contract_questionnaire_schema.sql'));
  await db.exec(read('tests', 'contract_obsolete_progress_schema.sql'));
  for (const [file, names] of [
    ['20260817234500_reconcile_contract_visits_with_real_tasks.sql', ['normalizar_cliente_visita']],
    ['20260818153000_optimize_contract_visit_sync.sql', ['cliente_rh_chave', 'clientes_rh_relacionados']],
    ['20260818150000_contract_questionnaire_accounting_matrix.sql', ['atividade_e_limpeza_coifa', 'contrato_e_limpeza_coifa']],
    ['20260818013000_convert_contract_forecast_card_to_realized.sql', ['atualizar_card_visita_contratual_por_execucao']],
    ['20260818183000_preserve_scheduled_contract_visit_after_execution.sql', ['anotar_execucao_no_card_programado', 'materializar_card_visita_contratual', 'proteger_card_visita_contratual_realizada']],
  ]) {
    for (const name of names) await db.exec(extract(read('migrations', file), name));
  }
  const legacy = read('migrations', '20260818013000_convert_contract_forecast_card_to_realized.sql');
  const fk = legacy.match(/DO \$\$[\s\S]*?\n\$\$;/);
  assert.ok(fk, 'FK original ausente');
  await db.exec(fk[0]);
  await db.exec(trigger(legacy, 'trg_execucao_materializar_card_visita_contratual'));
  await db.exec(trigger(legacy, 'trg_proteger_card_visita_contratual_realizada'));
  await db.exec(trigger(read('migrations', '20260818183000_preserve_scheduled_contract_visit_after_execution.sql'), 'trg_agenda_anotar_execucao_no_card_programado'));
  await db.exec(read('migrations', '20260914193000_preserve_contract_questionnaire_evidence.sql'));
  const assertions = read('tests', 'contract_obsolete_progress.sql');

  await assert.rejects(db.exec(assertions), /execucao removida manteve anotacao realizada/);
  await db.exec('ROLLBACK');
  console.log('PASS baseline: FK remove somente o ID e deixa anotacao realizada obsoleta.');

  await db.exec(read('migrations', '20260914200000_clear_obsolete_contract_visit_progress.sql'));
  await db.exec(assertions);
  console.log('PASS SQL: limpeza da execucao removida, preservacao manual, vinculos planejados, isolamento e reclassificacao coifa.');
} catch (error) {
  console.error(error.message);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
