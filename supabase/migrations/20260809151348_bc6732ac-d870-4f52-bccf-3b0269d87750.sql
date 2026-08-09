ALTER TABLE public.agenda_veiculos
  ADD COLUMN IF NOT EXISTS tvh_vehicle_id text,
  ADD COLUMN IF NOT EXISTS marca text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS observacao text,
  ADD COLUMN IF NOT EXISTS sincronizado_em timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS agenda_veiculos_tvh_vehicle_id_key
  ON public.agenda_veiculos (tvh_vehicle_id) WHERE tvh_vehicle_id IS NOT NULL;