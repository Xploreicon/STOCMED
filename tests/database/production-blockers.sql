-- Run after all migrations in a disposable database. Every failed assertion raises an exception.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'stock_movements_append_only') THEN
    RAISE EXCEPTION 'append-only stock_movements trigger is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'shift_id') THEN
    RAISE EXCEPTION 'sales.shift_id is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'drugs')
     OR EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'drugs_old') THEN
    RAISE EXCEPTION 'legacy drugs objects still exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_no_linked_plaintext') THEN
    RAISE EXCEPTION 'NDPR linked-plaintext constraint is missing';
  END IF;
END $$;

ROLLBACK;
