import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fetchCompleteGcCollection } from '../supabase/functions/_shared/gc-pagination.ts';

// Exercise the production mapping functions without starting the Edge handler.
const source = readFileSync(new URL('../supabase/functions/budget-kanban/index.ts', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('async function fetchGcOrcamentosMap('), source.indexOf('function hasFilledQuestionnaireAnswers('));
const build = new Function('fetchCompleteGcCollection', 'rateLimitedFetch', 'GC_BASE_URL', 'GC_ATRIBUTO_TAREFA_ORC', 'GC_ATRIBUTO_TAREFA_OS',
  stripTypeScriptTypes(section) + '\nreturn { fetchGcOrcamentosMap, fetchGcOsMap };');
const mapFunctions = fetcher => build(fetchCompleteGcCollection, fetcher, 'https://api.gestaoclick.com', '73341', '73343');

test('Kanban loads all 5357 budgets and 3025 OS, including pages after 30', async () => {
  const fetched = {orcamentos: [], ordens_servicos: []};
  const mapper = mapFunctions(async raw => {
    const url = new URL(raw), type = url.pathname.split('/').at(-1), page = Number(url.searchParams.get('pagina'));
    const total = type === 'orcamentos' ? 5357 : 3025;
    fetched[type].push(page);
    assert.equal(url.searchParams.get('limite'), '100');
    assert.equal(url.searchParams.get('data_inicio'), '2026-01-01');
    const records = Array.from({length: Math.min(100, total - (page - 1) * 100)}, (_, i) => {
      const id = String((page - 1) * 100 + i + 1);
      return {id, codigo:id, atributos:[{atributo:{atributo_id:type === 'orcamentos' ? '73341':'73343', conteudo:id}}]};
    });
    return Response.json({data:records, meta:{total_paginas:Math.ceil(total/100)}});
  });
  const [budgets, os] = await Promise.all([
    mapper.fetchGcOrcamentosMap({}, '2026-01-01', '2026-09-09'),
    mapper.fetchGcOsMap({}, '2026-01-01', '2026-09-09'),
  ]);
  assert.equal(Object.keys(budgets).length, 5357);
  assert.equal(budgets['5357'].gc_orcamento_id, '5357');
  assert.equal(Object.keys(os).length, 3025);
  assert.equal(os['3025'].gc_os_id, '3025');
  assert.equal(new Set(fetched.orcamentos).size, 54);
  assert.equal(new Set(fetched.ordens_servicos).size, 31);
});

test('a failed later page rejects the Kanban map instead of returning incomplete success', async () => {
  const mapper = mapFunctions(async raw => Number(new URL(raw).searchParams.get('pagina')) === 2
    ? Response.json({error:'fixture'}, {status:401})
    : Response.json({data:[], meta:{total_paginas:3}}));
  await assert.rejects(mapper.fetchGcOrcamentosMap({}), /página 2: HTTP 401.*cache anterior preservado/);
  await assert.rejects(mapper.fetchGcOsMap({}), /página 2: HTTP 401.*cache anterior preservado/);
});

test('temporary rate limits retry boundedly; malformed data is not an empty successful collection', async () => {
  let calls=0, rows=0;
  const pauses=[];
  await fetchCompleteGcCollection({url:'https://api.gestaoclick.com/api/orcamentos?limite=100',headers:{},
    fetcher:async()=> ++calls < 3 ? new Response(null,{status:429}) : Response.json({data:[{id:1}],meta:{total_paginas:1}}),
    sleep:async ms=>{pauses.push(ms);}, ingest:items=>{rows+=items.length;}});
  assert.equal(calls,3); assert.equal(rows,1); assert.deepEqual(pauses,[5000,10000]);
  await assert.rejects(fetchCompleteGcCollection({url:'https://api.gestaoclick.com/api/orcamentos',headers:{},
    fetcher:async()=>Response.json({message:'unexpected envelope'}),ingest:()=>assert.fail('must not ingest')}), /coleção ou paginação inválida/);
});
