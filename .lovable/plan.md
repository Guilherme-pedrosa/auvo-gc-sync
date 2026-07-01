# Gerar Plano de Preventivas — v5

Rework de `supabase/functions/plano-preventivo-gerar/index.ts` + `src/pages/financeiro/GerarPlanoPreventivasDialog.tsx`. Por cliente. Sem Excel. Sem grupo.

## 1. Backend

### Entrada
- `cliente_nome` + `ano_referencia`. Modos: `preview`, `apply` (apply reaproveita `meses_planejados`). Remove `export`.

### Contrato — precedência explícita
1. Contrato por `cliente_nome` direto com `horas_mes_contratadas > 0` → usa. Ignora grupo.
2. Senão, resolve grupos via `grupo_cliente_membros` e busca contrato por `grupo_id` com horas > 0.
3. Nenhum → `{ok:false, code:"SEM_CONTRATO"}`.
- Guarda `teto`, `vigencia_inicio`, `fonte: "cliente"|"grupo"`.

### Classificação (mantida)
- `override_manual` > `tipo_atual` > `ia_keywords` > `sem_tipo`.
- `sem_tipo` fora do scheduler; retorna em `sem_tipo[]` para aviso na UI.
- `visitas_ano`: MENSAL=12, BIMESTRAL=6, TRIMESTRAL=4, SEMESTRAL=2, ANUAL=1.
- `HT_oc = horas_por_tecnico × qtd_tecnicos`.

### Próxima preventiva
- Reaproveita `lastPrevByAuvoId` (tipos 180175/180176/202616/235724).
- Com última: `proxima = ultima + periodicidade`; senão descoberto puro.

### Atraso inicial
- **nunca**: `floor((hoje − vigencia_inicio)/30)` meses.
- **vencido** (`proxima < mesInicio`): `mesInicio − mes(proxima)`.
- **em dia** (`proxima >= mesInicio`): `-(mes(proxima) − mesInicio)` (0 ou negativo).
- Peso criticidade: CRÍTICA=4, ALTA=3, MÉDIA=2, BAIXA=1 (default 2).

### Scheduler — fila única, sem trava de exclusão
```
mesInicio = (anoRef == anoAtual) ? mesAtual : 1
reservado[1..12] = 0
primeiraVisita: Map<equipId, number>
proximaOriginal[eq] = mes(proxima)  // só p/ em-dia

for m = mesInicio..12:
  // "chegou a vez": descobertos desde mesInicio; em-dia a partir de proximaOriginal
  fila = equipamentos com tipo, sem entrada em primeiraVisita, elegíveis em m

  // status vivo + atraso vivo
  for eq in fila:
    if eq.origem == "em_dia" e m > proximaOriginal[eq]:
      eq.status_vivo = "vencido"
      eq.atraso_vivo = m - proximaOriginal[eq]
    else if eq.origem == "em_dia":
      eq.status_vivo = "em_dia"
      eq.atraso_vivo = -(proximaOriginal[eq] - m)
    else:  // nunca / vencido original
      eq.status_vivo = eq.origem
      eq.atraso_vivo = eq.atraso_base + (m - mesInicio)

  ordena fila por (atraso_vivo desc, criticidade desc)

  for eq in fila:
    cabe = reservado[m] + HT_oc <= teto
    vencido_vivo = eq.status_vivo in ("vencido","nunca") e eq.atraso_vivo > 0

    if cabe:
      encaixa
    else if vencido_vivo:
      encaixa mesmo assim  // saldo do mês vira negativo, visível
    else:
      continue  // em-dia sem atraso escorrega pro próximo mês

    if encaixado:
      primeiraVisita[eq] = m
      reservado[m] += HT_oc
      // ciclos subsequentes no ano
      m2 = m + periodicidade
      while m2 <= 12:
        reservado[m2] += HT_oc
        agenda[eq].push(m2)
        m2 += periodicidade
```
Efeitos:
- Descoberto atraso=3 supera em-dia atraso=0 → em-dia escorrega. Se em-dia ultrapassa `proximaOriginal`, vira vencido e força encaixe, mesmo estourando teto.
- Nenhum equipamento com preventiva devida some do plano.
- Saldo negativo é sinal legítimo de contrato sub-dimensionado.

### Resposta
```ts
{
  ok, ano_referencia, cliente_nome,
  contrato: { horas_mes_contratadas, vigencia_inicio, fonte },
  resumo: { total, nunca, vencidos, em_dia, sem_tipo_count, ht_ano },
  sem_tipo: [{equip_id, nome}],
  tabela_meses: [{mes, ht_agendada, teto, saldo}],
  itens: [{
    equip_id, codigo_barras_auvo, nome, categoria, criticidade, periodicidade,
    ht_oc, visitas_ano, ht_total_ano, meses_planejados: number[],
    ultima_preventiva, proxima_original,
    status: "nunca"|"vencido"|"em_dia",   // status final (após scheduler)
    atraso_meses,
    tipo_source, keyword_match
  }]
}
```
`itens` ordenados por `atraso desc, criticidade desc`. Status final = status vivo na hora do encaixe (em-dia que virou vencido reporta "vencido").

## 2. Frontend — `GerarPlanoPreventivasDialog.tsx`

- Remove escopo "Grupo" e botão "Baixar Excel".
- Matriz: `ID | Equipamento | Categoria | Crit | Period. | HT | Jan..Dez | Total`.
  - Célula mensal preenchida com HT quando `meses_planejados.includes(m)`; fundo por status: `nunca`=vermelho, `vencido`=âmbar, `em_dia`=verde.
  - Badge de status + tooltip com atraso.
- Rodapé sticky: **Total mês**, **Meta**, **Saldo** (vermelho <0).
- Cards topo: total, descobertos (nunca+vencidos), em-dia, HT/ano, saldo ano, meses com saldo negativo.
- Aviso amarelo listando `sem_tipo` + botão **Revisar classificação (IA)** abrindo `RevisarTiposIADialog` filtrado no cliente.
- `code === "SEM_CONTRATO"` → bloqueia com mensagem.
- "Implementar plano" chama `apply` inalterado.
