-- Esquema minimo das dependencias das RPCs, executado somente no banco efemero.
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE contrato_tipos (id uuid PRIMARY KEY, nome text);
CREATE TABLE rh_clientes (
  id uuid PRIMARY KEY, nome text, nome_gc text, nome_auvo text,
  nome_fantasia text, ativo boolean DEFAULT true, vinculo_status text,
  atualizado_em timestamptz DEFAULT now()
);
CREATE TABLE contratos (
  id uuid PRIMARY KEY, nome text, cliente_nome text, grupo_id uuid, tipo_id uuid,
  ativo boolean DEFAULT true, horas_mes_contratadas numeric DEFAULT 32,
  vigencia_inicio date, vigencia_fim date, atualizado_em timestamptz DEFAULT now()
);
CREATE TABLE contratos_visitas_config (
  id uuid PRIMARY KEY, contrato_id uuid, ativo boolean DEFAULT true,
  qtd_visitas integer DEFAULT 2, qtd_tecnicos integer DEFAULT 1,
  duracao_minutos integer DEFAULT 120, hora_inicio time DEFAULT '08:00',
  tecnico_ids uuid[] DEFAULT '{}', atualizado_em timestamptz DEFAULT now()
);
CREATE TABLE contratos_visitas_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contrato_visita_config_id uuid,
  contrato_id uuid, competencia date, visita_numero integer, data_realizada date,
  cliente text, cliente_chave text, horas_trabalhadas numeric DEFAULT 0,
  tarefa_ids text[] DEFAULT '{}', tecnicos text[] DEFAULT '{}',
  tarefas_detalhes jsonb DEFAULT '[]', atualizado_em timestamptz DEFAULT now(),
  UNIQUE (contrato_visita_config_id, cliente_chave, data_realizada)
);
CREATE TABLE grupo_cliente_membros (grupo_id uuid, cliente_nome text);
CREATE TABLE rh_colaboradores (id uuid PRIMARY KEY, nome text, ativo boolean DEFAULT true);
CREATE TABLE tarefas_central (
  mirror_key text PRIMARY KEY, auvo_task_id text, cliente text, data_tarefa date,
  tecnico text, descricao text, task_type_id text, status_auvo text,
  duracao_decimal numeric, check_out boolean DEFAULT false, data_conclusao date,
  check_in_iso text, check_out_iso text, hora_inicio text, hora_fim text,
  gc_os_codigo text, auvo_link text, auvo_task_url text,
  questionario_id text, questionario_respostas jsonb DEFAULT '[]', outros_questionarios jsonb,
  criado_em timestamptz DEFAULT now(), atualizado_em timestamptz DEFAULT now()
);
CREATE TABLE agenda_agendamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), data date, hora_inicio time, hora_fim time,
  colaborador_id uuid, colaborador_nome text, cliente text, descricao text, status text,
  origem text, auvo_task_id text, previsao_continuidade boolean, previsao_tipo text,
  previsao_detalhes text, contrato_id uuid, contrato_visita_config_id uuid,
  contrato_visita_competencia text, contrato_visita_numero integer,
  duracao_planejada_minutos integer, contrato_visita_execucao_id uuid,
  contrato_visita_realizada_em date, contrato_visita_tarefa_ids text[] DEFAULT '{}',
  contrato_visita_tecnicos text[] DEFAULT '{}'
);
CREATE UNIQUE INDEX test_agenda_contrato_unique ON agenda_agendamentos (
  cliente, data, COALESCE(colaborador_id::text,''),
  COALESCE(contrato_visita_config_id::text,''),
  COALESCE(contrato_visita_execucao_id::text,'')
) WHERE origem = 'CONTRATO';
