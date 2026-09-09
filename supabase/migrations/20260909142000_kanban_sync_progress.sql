-- Additive diagnostics: no change to existing cards, columns, or sync status.
ALTER TABLE public.kanban_sync_meta
  ADD COLUMN IF NOT EXISTS sync_progress jsonb;
