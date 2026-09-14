import { accessSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// These are release checks, not optional tests: deleting the files must fail
// the build instead of silently publishing the incident again.
const files = [
  'src/test/agendamento-equipe-pagination.test.tsx',
  'src/test/agendamento-equipe-dialog.test.tsx',
  'src/test/criar-tarefa-agenda-sync.test.tsx',
  'src/test/agenda-auvo-reconciliation.test.ts',
  'src/test/agenda-forecast-link-guard.test.ts',
  'src/test/auvo-task-status-source.test.ts',
  'src/test/budget-forecast-promotion.test.ts',
  'src/test/budget-forecast-reconciliation.test.ts',
  'src/test/budget-execution-link-guard.test.ts',
  'src/test/central-sync-auvo-pagination.test.ts',
  'src/test/auvo-empty-day-confirmation.test.ts',
  'src/test/reports-sync.test.ts',
  'src/test/reports-sync-page.test.tsx',
  'src/test/reports-sync-day-recovery.test.ts',
];
for (const file of files) accessSync(file);
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
