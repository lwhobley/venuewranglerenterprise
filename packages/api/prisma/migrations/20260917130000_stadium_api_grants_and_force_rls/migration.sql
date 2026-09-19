-- Re-assert append-only grants and FORCE RLS where it is safe to do so.
--
-- Background on why this is narrower than it first looks.
--
-- 1. Bulk grants are NOT this migration's job. scripts/rls-cutover/phase0-roles.sql
--    already issues `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN
--    SCHEMA public TO stadium_api` plus matching ALTER DEFAULT PRIVILEGES. The
--    reason staging currently shows only 41 of 142 tables granted is simply
--    that phase0-roles.sql has never been run there (no stadium_api LOGIN
--    exists yet) -- not a missing migration. Duplicating those grants here
--    would add nothing.
--
-- 2. What phase0's blanket grant DOES break is append-only enforcement.
--    20260904180000_vms_audit_log_append_only_via_grants deliberately revoked
--    UPDATE/DELETE on VmsAuditLog -- "via grants" is the mechanism named in
--    that migration -- and phase0, run afterwards at cutover, grants them
--    straight back. The same applies to the other trigger-protected ledgers.
--    This migration re-asserts those revokes, and phase0-roles.sql has been
--    amended to stop clobbering them in the first place; both directions are
--    needed because the two can be run in either order.
--
-- 3. FORCE RLS cannot be applied across the board, and this is the important
--    finding. PostgreSQL exempts a table's owner from RLS only while the table
--    is not FORCE'd, and the app_private SECURITY DEFINER helpers depend on
--    exactly that exemption: they run as the table owner (stadium_migrator
--    after phase0's ownership reassignment) and read tenant tables before any
--    tenant GUC can exist. Critically, app_private.venue_matches() -- the
--    function that ~88 tenant policies call -- reads "Profile". Forcing
--    "Profile" would subject that read to Profile's own policy, which calls
--    venue_matches, and the whole tenant surface would fail closed. Forcing
--    "Session"/"Venue"/"Role" would break AuthGuard's bootstrap lookups the
--    same way (see 20260903140000_auth_bootstrap_security_definer).
--
--    So the tables read by any SECURITY DEFINER helper are carved out and
--    deliberately left un-FORCE'd. That is a real, load-bearing limitation of
--    the current design, not an oversight: owner-exemption IS the bootstrap
--    mechanism. Removing the carve-out requires redesigning those helpers
--    (for example, policies that admit the migrator role explicitly) and must
--    not be done as a side effect of a grants migration.
--
-- The final assertion below is self-policing: if anyone later adds a
-- SECURITY DEFINER helper that reads a table this migration has FORCE'd, the
-- migration fails rather than silently breaking authentication.

DO $$
DECLARE
  t text;
  -- Trigger-enforced append-only tables: no UPDATE, no DELETE for the runtime
  -- role. VmsAuditLog and AsyncWriteReceipt already carry their intended
  -- grants; they are listed so a later phase0 run cannot widen them back.
  append_only text[] := ARRAY[
    'EventAuditLog',
    'EventCloseoutRevision',
    'InventoryTransaction',
    'VmsAuditLog'
  ];
  -- Tables read by an app_private SECURITY DEFINER helper. These rely on
  -- owner-exemption from RLS and must NOT be forced. Kept explicit so the
  -- carve-out is reviewable; the assertion at the end proves it is complete.
  definer_dependencies text[] := ARRAY[
    'DepartmentAreaRule',
    'DepartmentMembership',
    'OrganizationMembership',
    'Profile',
    'Role',
    'ScopeAssignment',
    'Session',
    'UserAreaOverride',
    'Venue'
  ];
  forced integer := 0;
  offender text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    RAISE NOTICE 'stadium_api role absent; skipping grants and FORCE RLS (applied at cutover).';
    RETURN;
  END IF;

  FOREACH t IN ARRAY append_only LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE EXCEPTION 'Expected append-only table %.% not found', 'public', t;
    END IF;

    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO stadium_api', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON public.%I FROM stadium_api', t);
  END LOOP;

  -- Force RLS on policied tables, except the SECURITY DEFINER dependencies.
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relforcerowsecurity
      AND NOT (c.relname = ANY (definer_dependencies))
      AND EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    forced := forced + 1;
  END LOOP;

  RAISE NOTICE 'Append-only grants re-asserted; FORCE RLS newly set on % table(s).', forced;

  -- Self-policing: no SECURITY DEFINER helper may reference a FORCE'd table,
  -- because such a helper would lose the owner-exemption it depends on.
  SELECT c.relname INTO offender
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relforcerowsecurity
    AND EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace pn ON pn.oid = p.pronamespace
      WHERE pn.nspname = 'app_private'
        AND p.prosecdef
        AND pg_get_functiondef(p.oid) LIKE '%"' || c.relname || '"%'
    )
  LIMIT 1;

  IF offender IS NOT NULL THEN
    RAISE EXCEPTION
      'Table "%" is FORCE RLS but is read by an app_private SECURITY DEFINER helper, which depends on owner-exemption. Add it to definer_dependencies or redesign the helper.',
      offender;
  END IF;
END
$$;
