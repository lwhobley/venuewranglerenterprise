ALTER TABLE operational_tasks
  ADD COLUMN external_source text,
  ADD COLUMN external_task_id text;

ALTER TABLE operational_tasks
  ADD CONSTRAINT operational_tasks_external_source_check
    CHECK (external_source IS NULL OR external_source ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  ADD CONSTRAINT operational_tasks_external_id_check
    CHECK (external_task_id IS NULL OR length(external_task_id) BETWEEN 1 AND 240),
  ADD CONSTRAINT operational_tasks_external_pair_check
    CHECK ((external_source IS NULL) = (external_task_id IS NULL));

CREATE UNIQUE INDEX operational_tasks_org_external_task_key
  ON operational_tasks (organization_id, external_source, external_task_id);
