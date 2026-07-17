# Medicina e Segurança — V1

Módulo enxuto focado em **ciclo de vida dos exames ocupacionais (ASO)**. Reutiliza o cadastro de colaborador existente e escreve o PDF do ASO no mesmo lugar do prontuário (`rh_colaborador_docs` tipo `ASO`), garantindo que o documento apareça em **RH → Colaborador → Prontuário → Saúde Ocupacional** sem duplicação.

## Escopo e princípios

- Não altera cadastro de colaborador, buckets, tipos de documento existentes, nem regras do RH.
- Colaborador continua único; o módulo apenas consome `rh_colaboradores`.
- ASO em PDF continua no bucket `rh-documentos` e na tabela `rh_colaborador_docs` (tipo `ASO`) — mesma estrutura já usada hoje.
- O que é novo: metadados operacionais (tipo do ASO, clínica, médico, agendamento, status do processo), não presentes hoje.

## Estrutura de menu (AppLayout, seção nova para admin)

```text
Medicina e Segurança
├── Dashboard        /med-seg/dashboard
├── Saúde Ocupacional /med-seg/saude-ocupacional
├── Agenda           /med-seg/agenda
└── Configurações
    ├── Tipos de ASO         /med-seg/config/tipos-aso
    ├── Clínicas             /med-seg/config/clinicas
    └── Periodicidade        /med-seg/config/periodicidade
```

## Banco de dados (novas tabelas — schema `public`)

Todas com GRANTs `authenticated`+`service_role`, RLS ligado, políticas via `has_role(auth.uid(), 'admin')` (mesmo padrão do RH existente), triggers de `updated_at`.

- `med_tipos_aso` — `codigo` (Admissional, Periódico, Retorno, Mudança de Função, Demissional), `nome`, `periodicidade_meses` (nullable), `ativo`. Seed com os 5 tipos padrão.
- `med_clinicas` — `nome`, `contato`, `endereco`, `observacoes`, `ativo`.
- `med_aso` — `colaborador_id` (fk), `tipo_id` (fk med_tipos_aso), `data_emissao`, `data_validade`, `clinica_id`, `medico_nome`, `medico_crm`, `situacao` (`valido|vencido|substituido`), `documento_id` (fk `rh_colaborador_docs.id` — o PDF), `agendamento_id` (fk med_agendamentos, nullable), `vigente` (bool). Índice único parcial: um único `vigente=true` por colaborador.
- `med_agendamentos` — `colaborador_id`, `tipo_id`, `data`, `hora`, `clinica_id`, `observacoes`, `status` (`agendado|confirmado|realizado|cancelado`), `aso_id` (nullable, preenchido quando gera ASO).
- `med_historico` — `colaborador_id`, `evento` (`aso_novo|agendamento_novo|reagendado|documento_anexado|cancelado|situacao_alterada`), `payload jsonb`, `criado_em`, `criado_por`.

Triggers:
- Ao inserir `med_aso` com `vigente=true`: marca o ASO anterior do mesmo colaborador como `vigente=false, situacao='substituido'`.
- Ao inserir `med_aso`: calcula `data_validade` se null usando `periodicidade_meses` do tipo.
- Ao mudar `status` de agendamento: escreve linha em `med_historico`.

Nenhuma alteração em `rh_colaborador_docs` — quando o PDF é anexado pelo módulo, cria um registro normal em `rh_colaborador_docs` com `tipo_codigo='ASO'`, e guarda o `id` em `med_aso.documento_id`. Assim aparece automaticamente no Prontuário → Saúde Ocupacional.

## Frontend

Componentes reutilizados: `SearchableSelect`, `Table`, `Dialog`, `Tabs`, `Card`, upload já usado em `ColaboradorDetailPage`.

### Dashboard (`/med-seg/dashboard`)
- KPIs: total monitorados, ASOs válidos, vencendo (≤30d), vencidos, agendados, realizados aguardando upload.
- **Fila priorizada de ações** (sugestão estratégica aceita):
  - 🔴 ASO vencido / vencendo em ≤7 dias — CTA "Agendar"
  - 🟠 Agendamento amanhã — CTA "Confirmar"
  - 🟡 Realizado sem PDF — CTA "Anexar ASO"
  - 🔴 Sem ASO cadastrado — CTA "Cadastrar"
- Cada item leva ao colaborador/agendamento correspondente.

### Saúde Ocupacional (`/med-seg/saude-ocupacional`)
- Listagem: Nome, Cargo, Empresa, Último ASO (tipo/data), Validade, Situação (badge), Próximo previsto.
- Situação: `Válido | Vencendo | Vencido | Agendado | Aguardando Documento`.
- Clique abre `/med-seg/saude-ocupacional/:colaboradorId` com abas: **Dados**, **ASOs**, **Agendamentos**, **Histórico** (view enxuta, não duplica o prontuário completo).
- Aba **ASOs**: histórico + botão "Novo ASO" (form: tipo, emissão, validade auto-calculada, clínica, médico, upload PDF). Upload cria registro em `rh_colaborador_docs` **e** em `med_aso`.
- Aba **Agendamentos**: CRUD simples, botão "Marcar como Realizado" abre modal de anexo de ASO.

### Agenda (`/med-seg/agenda`)
- 3 abas: Hoje / Próximos 7 dias / Próximos 30 dias.
- Botão "Novo Agendamento" (dialog reutilizável).

### Configurações
- Três páginas CRUD simples baseadas no padrão de `TiposDocumentoPage.tsx`.

## Integração com o RH existente

- ASO anexado no módulo → grava em `rh_colaborador_docs` com `tipo_codigo='ASO'`, `data_emissao`, `data_validade`, `arquivo_url`, `escopo='TECHNICIAN'`.
- Prontuário do colaborador (`ColaboradorDetailPage`) já lista ASO em **Saúde Ocupacional** (categoria já criada na turn anterior). Nada muda lá.
- O que aparece por lá continua sendo o PDF + histórico documental; o **ciclo de vida operacional** (agenda, status, vencimento antecipado) vive no novo módulo.

## Fora de escopo desta V1

- Gráficos, cálculo de próxima data por idade/risco, notificações e-mail/WhatsApp, PPRA/LTCAT, workflow ASO admissional integrado a admissão automática.

## Detalhes técnicos

- Migrações em uma call `supabase--migration` com todas as tabelas + GRANTs + RLS + policies + seed dos 5 tipos.
- Rotas em `src/App.tsx` (admin only via `ProtectedRoute` existente).
- Menu novo em `AppLayout.tsx` no bloco `isAdmin`.
- Sem edge function nesta V1 — tudo via Supabase client + RLS.
