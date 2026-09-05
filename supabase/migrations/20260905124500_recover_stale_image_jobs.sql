-- Recupera automaticamente pesquisas de imagem que ficaram presas em processing.
-- O job apenas devolve para pending registros sem imagem que estão parados há 30+ minutos.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon, authenticated;

CREATE OR REPLACE FUNCTION private.requeue_stale_image_processing()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.products
  SET image_status = 'pending'
  WHERE image_status = 'processing'
    AND image_url IS NULL
    AND image_last_checked_at < now() - interval '30 minutes';

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION private.requeue_stale_image_processing() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.requeue_stale_image_processing() FROM anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'requeue-stale-image-processing'
  ) THEN
    PERFORM cron.schedule(
      'requeue-stale-image-processing',
      '*/5 * * * *',
      'select private.requeue_stale_image_processing();'
    );
  END IF;
END;
$$;
