-- Pin the append-only ledger trigger's search_path (Supabase advisor
-- 0011_function_search_path_mutable). The body only calls pg_catalog
-- built-ins, so an empty search_path changes nothing about its behaviour.
ALTER FUNCTION public.app_private_inventory_ledger_immutable() SET search_path = '';
