-- 0007 market commentary library: the firm's dated national, state and local paragraphs.

-- Versioned like templates: a standards owner writes a draft, another standards owner approves it,
-- and an approved version never changes (next quarter's view is a new version). `data` holds the
-- whole paragraph (text, sources, author, approver); the columns repeat what lookups filter on.
CREATE TABLE commentary_module (
  id            uuid PRIMARY KEY,
  org_id        uuid NOT NULL REFERENCES organisation(id),
  module_id     text NOT NULL,
  version       integer NOT NULL CHECK (version > 0),
  level         text NOT NULL CHECK (level IN ('national', 'state', 'local')),
  jurisdiction  text NULL,
  as_at_date    date NOT NULL,
  status        text NOT NULL CHECK (status IN ('draft', 'approved', 'retired')),
  data          jsonb NOT NULL,
  UNIQUE (org_id, module_id, version),
  -- the JSON copy must agree with the columns lookups and approvals rely on
  CHECK (data->>'moduleId' = module_id AND data->>'version' = version::text
         AND data->>'level' = level AND data->>'status' = status)
);

CREATE INDEX commentary_module_lookup ON commentary_module (org_id, status, level);

-- Drafts may change or be deleted. Approved and retired versions cannot; the one permitted change
-- is approved → retired, which may only add the status and retirement details to the JSON copy.
CREATE FUNCTION guard_commentary_module() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'immutable record: % commentary versions cannot be deleted', OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF NOT (OLD.status = 'approved' AND NEW.status = 'retired')
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.module_id IS DISTINCT FROM OLD.module_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.level IS DISTINCT FROM OLD.level
     OR NEW.jurisdiction IS DISTINCT FROM OLD.jurisdiction
     OR NEW.as_at_date IS DISTINCT FROM OLD.as_at_date
     OR (NEW.data - 'status' - 'retiredBy' - 'retiredAt') IS DISTINCT FROM (OLD.data - 'status' - 'retiredBy' - 'retiredAt') THEN
    RAISE EXCEPTION 'immutable record: % commentary versions may only be retired', OLD.status USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER commentary_module_guard
  BEFORE UPDATE OR DELETE ON commentary_module
  FOR EACH ROW EXECUTE FUNCTION guard_commentary_module();
