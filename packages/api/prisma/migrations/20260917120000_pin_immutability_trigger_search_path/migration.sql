-- Pin the remaining immutability triggers' search_path (Supabase advisor
-- 0011_function_search_path_mutable), completing the fix started in
-- 20260915130000 for the inventory ledger trigger.
--
-- Both bodies are a bare RAISE EXCEPTION: they read no tables and call no
-- functions, so an empty search_path cannot change their behaviour. Pinning
-- matters because these two functions are the tamper-protection for the event
-- audit log and the closeout revision ledger; a caller-controlled search_path
-- is the wrong thing to leave resolvable on exactly those triggers.
ALTER FUNCTION public.prevent_event_audit_mutation() SET search_path = '';
ALTER FUNCTION app_private.prevent_closeout_revision_mutation() SET search_path = '';
