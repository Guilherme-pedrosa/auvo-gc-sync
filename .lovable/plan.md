
## Objetivo

Trazer para este projeto (WeDo) o módulo de **RH** do WAI ERP: matriz de integrações, dashboard, requisitos por cliente, colaboradores com prontuário, tipos de documento e documentos da empresa. Criar uma tabela local de **clientes** já populada com os nomes que aparecem em OS/Orçamentos, e completar CPF/CNPJ, endereço, contato via API do GestãoClick.

## Estrutura do banco

Novas tabelas em `public` (com GRANT + RLS por `authenticated`, admin via `has_role`):

```text
rh_clientes             — cliente unificado (id, gc_cliente_id, nome, fantasia,
                          cpf_cnpj, email, telefone, endereco, ativo,
                          origem: 'cache' | 'gc' | 'manual', sync_em)
rh_colaboradores        — PF/PJ (nome, cpf_cnpj, cargo, funcao, email, tel, ativo)
rh_document_types       — catálogo (code, name, scope: COMPANY|TECHNICIAN|CLIENT,
                          requires_expiry, ativo)
rh_company_documents    — documentos da própria empresa (WeDo)
rh_colaborador_docs     — docs por colaborador (tipo, emissão, vencimento, arquivo)
rh_client_requirements  — o que cada cliente exige (client_id, doc_type_id,
                          required_for: COMPANY|TECHNICIAN, is_required)
rh_integrations         — kit de integração (client_id, technician_ids[],
                          status: draft|authorized|sent|blocked|expired,
                          validated_at, sent_at, earliest_expiry_date,
                          blocked_reasons jsonb, zip_file_name, zip_url)
rh_integration_audit    — auditoria de ações
```

Bucket de storage `rh-documentos` para arquivos (com policies por autenticado).

Semente inicial: um seed insere em `rh_clientes` todos os nomes distintos de cliente já presentes em `followup_kanban_cache` (marcados `origem='cache'`).

## Backend / Edge Functions

- `rh-clientes-sync-gc`: percorre `rh_clientes` sem `gc_cliente_id` (ou marcados para reenriquecer), busca no GC via `gc-proxy` por nome, faz merge (não destrutivo) e preenche CPF/CNPJ, endereço, e-mail, telefone. Roda sob demanda por botão "Sincronizar com GC".
- `rh-integrations-validate`: recalcula status/blocked_reasons cruzando `rh_colaborador_docs`, `rh_company_documents` e `rh_client_requirements`.

## Frontend

Novas rotas em `AppLayout` (grupo "RH", somente admin):

```text
/rh/colaboradores               — lista + CRUD
/rh/colaboradores/:id           — prontuário (docs + integrações do colab)
/rh/clientes                    — lista dos clientes locais + botão "Sync GC" + edição
/rh/clientes/:id/requisitos     — cadastro de requisitos por cliente (empresa + técnico)
/rh/integracoes                 — matriz (filtros, status, exportar Excel)
/rh/integracoes/dashboard       — KPIs, pendências, vencimentos
/rh/integracoes/nova            — form de nova integração (cliente + técnicos)
/rh/tipos-documento             — catálogo
/rh/documentos-empresa          — docs da própria empresa
```

Componentes principais adaptados do WAI ERP (removendo dependência de `companies` / `CompanyContext`, `pessoas` unificada):
- Hooks: `useRhClientes`, `useRhColaboradores`, `useRhDocumentTypes`, `useRhCompanyDocuments`, `useRhClientRequirements`, `useRhIntegrations` + `useRhIntegrationsDashboard`.
- `IntegrationDetailModal`, `SearchableSelect` (já existe algo similar aqui — reaproveitar).

## Detalhes técnicos

- Sem `companies`/`CompanyContext`: escopo é global (uma empresa). RLS: `authenticated` lê tudo; escrita/edição só `admin` via `has_role`.
- Arquivos vão para `storage.rh-documentos/{colaborador_id}/{tipo}/{uuid}.{ext}` com policy de leitura para autenticados e escrita/delete para admin.
- Sync com GC: usa a Edge Function existente `gc-proxy` (endpoint `/api/clientes?nome=...`). Merge preserva edições manuais (`origem='manual'` não é sobrescrito).
- Semente de `rh_clientes`: `INSERT ... SELECT DISTINCT cliente FROM followup_kanban_cache WHERE cliente IS NOT NULL ON CONFLICT DO NOTHING`.
- Menu do sidebar (`AppLayout.tsx`): novo grupo **RH** com os itens acima, visível só para admin (padrão já usado para "Administração").

## Ordem de execução

1. Migração 1: `rh_document_types`, `rh_company_documents`, `rh_clientes` (+ seed do cache), `rh_colaboradores`, `rh_client_requirements`, `rh_colaborador_docs`, `rh_integrations`, `rh_integration_audit` + policies + GRANTs + bucket `rh-documentos` + seed inicial de tipos comuns (ASO, NR10, NR35, NR33, CNH, FICHA_REGISTRO, CONTRATO_SOCIAL, ALVARÁ).
2. Edge Function `rh-clientes-sync-gc`.
3. Hooks React Query (`src/hooks/rh/*`).
4. Páginas em `src/pages/rh/*` (Colaboradores, ColaboradorDetail, Clientes, ClienteRequisitos, MatrizIntegracoes, IntegracoesDashboard, NovaIntegracao, TiposDocumento, DocumentosEmpresa).
5. Rotas em `App.tsx` + grupo "RH" em `AppLayout.tsx`.
6. Componentes auxiliares (`IntegrationDetailModal`).

## Fora do escopo

- Multi-tenant (`companies`) — este projeto não usa.
- Envio automático de e-mail com anexo ZIP — mantido como `mailto:` (idêntico ao WAI ERP).
- Portal do cliente exibindo requisitos (pode ser feito depois se você pedir).

Confirma para começar pela migração?
