
-- Remove all overly-permissive anonymous policies and revoke EXECUTE on definer functions from anon.

-- atividades_nao_executadas
DROP POLICY IF EXISTS anon_all_atividades ON public.atividades_nao_executadas;

-- auvo_gc_usuario_map
DROP POLICY IF EXISTS anon_insert_map ON public.auvo_gc_usuario_map;
DROP POLICY IF EXISTS anon_update_map ON public.auvo_gc_usuario_map;
DROP POLICY IF EXISTS anon_read_map ON public.auvo_gc_usuario_map;

-- kanban caches
DROP POLICY IF EXISTS anon_all_custom_cache ON public.kanban_custom_cache;
DROP POLICY IF EXISTS anon_all_oficina_cache ON public.kanban_oficina_cache;
DROP POLICY IF EXISTS anon_all_cache ON public.kanban_orcamentos_cache;
DROP POLICY IF EXISTS anon_all_os_cache ON public.kanban_os_cache;
DROP POLICY IF EXISTS anon_all_resolution_details ON public.kanban_resolution_details;
DROP POLICY IF EXISTS anon_all_meta ON public.kanban_sync_meta;

-- os_revisao
DROP POLICY IF EXISTS anon_read_os_revisao ON public.os_revisao;
DROP POLICY IF EXISTS anon_read_revisao ON public.os_revisao;

-- tarefas_central
DROP POLICY IF EXISTS anon_read_central ON public.tarefas_central;

-- sync log
DROP POLICY IF EXISTS anon_read_log ON public.auvo_gc_sync_log;

-- demerito_lancamentos
DROP POLICY IF EXISTS anon_read_demerito_lanc ON public.demerito_lancamentos;
DROP POLICY IF EXISTS anon_read_demerito_motivos ON public.demerito_motivos;

-- equipamento_tarefas_auvo
DROP POLICY IF EXISTS "Anon can read equipamento_tarefas" ON public.equipamento_tarefas_auvo;

-- metas_tecnicos
DROP POLICY IF EXISTS anon_read_metas_tec ON public.metas_tecnicos;

-- alertas_horas_config (also exposes config to anon)
DROP POLICY IF EXISTS anon_read_alertas ON public.alertas_horas_config;
DROP POLICY IF EXISTS anon_read_alertas_config ON public.alertas_horas_config;

-- Revoke anon table grants where they leak by default
REVOKE ALL ON public.atividades_nao_executadas FROM anon;
REVOKE ALL ON public.auvo_gc_usuario_map FROM anon;
REVOKE ALL ON public.kanban_custom_cache FROM anon;
REVOKE ALL ON public.kanban_oficina_cache FROM anon;
REVOKE ALL ON public.kanban_orcamentos_cache FROM anon;
REVOKE ALL ON public.kanban_os_cache FROM anon;
REVOKE ALL ON public.kanban_resolution_details FROM anon;
REVOKE ALL ON public.kanban_sync_meta FROM anon;
REVOKE ALL ON public.os_revisao FROM anon;
REVOKE ALL ON public.tarefas_central FROM anon;
REVOKE ALL ON public.auvo_gc_sync_log FROM anon;
REVOKE ALL ON public.demerito_lancamentos FROM anon;
REVOKE ALL ON public.demerito_motivos FROM anon;
REVOKE ALL ON public.equipamento_tarefas_auvo FROM anon;
REVOKE ALL ON public.metas_tecnicos FROM anon;
REVOKE ALL ON public.alertas_horas_config FROM anon;

-- Revoke EXECUTE on SECURITY DEFINER trigger/internal functions from anon and authenticated.
-- These are invoked from triggers / edge functions; users should not call them.
REVOKE EXECUTE ON FUNCTION public.update_os_revisao_atualizado_em() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_os_revisao_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_capture_rescheduled_atraso() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_os_locks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
-- has_role is intentionally callable by authenticated users (used by RLS expressions).
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;
