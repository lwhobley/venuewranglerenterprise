SET app.actor_id = 'development-seed';
SET app.tenant_id = '00000000-0000-4000-8000-000000000001';

INSERT INTO organizations (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Harbor City Events')
ON CONFLICT (id) DO NOTHING;

INSERT INTO venues (id, organization_id, name)
VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Harbor City Arena'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Harbor City Annex')
ON CONFLICT (id) DO NOTHING;

INSERT INTO events (id, organization_id, venue_id, name, starts_at)
VALUES ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Storm vs. Comets', now() + interval '1 day')
ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, organization_id, venue_id, name)
VALUES
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Suite 14 pantry'),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'East bar'),
  ('30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'West Gate'),
  ('30000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'Annex loading bay')
ON CONFLICT (id) DO NOTHING;

SET app.tenant_id = '00000000-0000-4000-8000-000000000002';

INSERT INTO organizations (id, name)
VALUES ('00000000-0000-4000-8000-000000000002', 'North Harbor Events')
ON CONFLICT (id) DO NOTHING;

INSERT INTO venues (id, organization_id, name)
VALUES ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'North Harbor Pavilion')
ON CONFLICT (id) DO NOTHING;

INSERT INTO events (id, organization_id, venue_id, name, starts_at)
VALUES ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Falcons vs. Pilots', now() + interval '1 day')
ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, organization_id, venue_id, name)
VALUES ('30000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'North suite prep')
ON CONFLICT (id) DO NOTHING;

-- Local-only account used by the development login. It is never migrated into production.
SET app.tenant_id = '00000000-0000-4000-8000-000000000003';

INSERT INTO organizations (id, slug, name)
VALUES ('00000000-0000-4000-8000-000000000003', 'venue-test-lab', 'Venue Test Lab')
ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name;

INSERT INTO venues (id, organization_id, name, time_zone, lifecycle_state, activated_at, activated_by)
VALUES ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003', 'Test Lab Arena', 'America/Chicago', 'ACTIVE', now(), 'local-test-operator')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, time_zone = EXCLUDED.time_zone, lifecycle_state = EXCLUDED.lifecycle_state;

INSERT INTO locations (id, organization_id, venue_id, name)
VALUES ('30000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'Test Concourse')
ON CONFLICT (id) DO NOTHING;

INSERT INTO events (id, organization_id, venue_id, name, starts_at)
VALUES ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'Test Event', now() + interval '1 day')
ON CONFLICT (id) DO NOTHING;

INSERT INTO people (id, organization_id, external_subject, email, display_name, active, provisioning_source)
VALUES ('40000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', 'local-test-operator', 'tester@venuewrangler.invalid', 'Test Operator', true, 'admin')
ON CONFLICT (id) DO UPDATE SET active = true, display_name = EXCLUDED.display_name;
