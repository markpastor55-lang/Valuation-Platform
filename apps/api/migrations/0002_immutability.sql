-- 0002 immutability guards
-- Defence in depth: the application never updates or deletes these records, and the database
-- refuses to as well. (Production additionally revokes UPDATE/DELETE from the application role.)

CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable record: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END
$$;

-- Audit events are append-only.
CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Field history, certifications, measurement approvals and invoices are append-only.
CREATE TRIGGER field_value_history_append_only
  BEFORE UPDATE OR DELETE ON field_value_history
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER certification_append_only
  BEFORE UPDATE OR DELETE ON certification
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER measurement_approval_append_only
  BEFORE UPDATE OR DELETE ON measurement_approval
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER invoice_append_only
  BEFORE UPDATE OR DELETE ON invoice
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Issued reports: content is immutable; the only permitted change is issued → superseded.
CREATE FUNCTION guard_report_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'immutable record: issued reports cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot
     OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
     OR NEW.pdf IS DISTINCT FROM OLD.pdf
     OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NOT (OLD.status = 'issued' AND NEW.status IN ('issued', 'superseded')) THEN
    RAISE EXCEPTION 'immutable record: issued report content cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER report_immutable
  BEFORE UPDATE OR DELETE ON report
  FOR EACH ROW EXECUTE FUNCTION guard_report_update();

-- Frozen sketch versions (used in an issued report) cannot change; approved ones may only freeze.
CREATE FUNCTION guard_sketch_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status <> 'working' THEN
    RAISE EXCEPTION 'immutable record: % sketch versions cannot be deleted', OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'frozen' THEN
      RAISE EXCEPTION 'immutable record: frozen sketch versions cannot change' USING ERRCODE = 'P0001';
    END IF;
    -- the JSON copy carries the status too; everything else must be unchanged
    IF OLD.status = 'approved' AND (NEW.status <> 'frozen' OR (NEW.data - 'status') IS DISTINCT FROM (OLD.data - 'status')
                                    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash) THEN
      RAISE EXCEPTION 'immutable record: approved sketch versions may only be frozen' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END
$$;

CREATE TRIGGER sketch_version_guard
  BEFORE UPDATE OR DELETE ON sketch_version
  FOR EACH ROW EXECUTE FUNCTION guard_sketch_update();

-- Records under legal hold cannot be deleted (jobs and their dependants are never hard-deleted
-- by the application; retention jobs check legal holds first — see docs/spec/11).
CREATE FUNCTION guard_job_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM legal_hold h
             WHERE h.released_at IS NULL
               AND ((h.scope_type = 'job' AND h.scope_id = OLD.id)
                 OR (h.scope_type = 'client' AND h.scope_id = OLD.client_id)
                 OR (h.scope_type = 'portfolio' AND h.scope_id = OLD.portfolio_id))) THEN
    RAISE EXCEPTION 'legal hold: job % cannot be deleted', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END
$$;

CREATE TRIGGER job_legal_hold_guard
  BEFORE DELETE ON job
  FOR EACH ROW EXECUTE FUNCTION guard_job_delete();
