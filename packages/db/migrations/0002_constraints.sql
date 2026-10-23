-- Constraints Drizzle cannot express (DATA-MODEL.md): cross-file FKs, EXCLUDE ranges, trigram index,
-- integrity triggers and append-only grants. Written by hand; reviewed like code.

-- Cross-file foreign keys
ALTER TABLE departments ADD CONSTRAINT departments_head_employee_fk
  FOREIGN KEY (head_employee_id) REFERENCES employees(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE companies ADD CONSTRAINT companies_logo_document_fk
  FOREIGN KEY (logo_document_id) REFERENCES documents(id) ON DELETE RESTRICT;
--> statement-breakpoint

-- Non-overlapping effective-dated ranges (needs btree_gist)
ALTER TABLE schedule_assignments ADD CONSTRAINT schedule_assignments_no_overlap
  EXCLUDE USING gist (employee_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&);
--> statement-breakpoint
ALTER TABLE leave_policies ADD CONSTRAINT leave_policies_no_overlap
  EXCLUDE USING gist (leave_type_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&);
--> statement-breakpoint
ALTER TABLE salary_structures ADD CONSTRAINT salary_structures_no_overlap
  EXCLUDE USING gist (employee_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
  WHERE (status = 'approved');
--> statement-breakpoint
CREATE INDEX leave_requests_range_idx ON leave_requests USING gist (employee_id, daterange(start_date, end_date, '[]'));
--> statement-breakpoint
CREATE INDEX employees_name_trgm_idx ON employees USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
--> statement-breakpoint

-- Derived roles (manager, employee) are never stored in user_roles
CREATE FUNCTION user_roles_no_derived() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND is_derived) THEN
    RAISE EXCEPTION 'derived roles cannot be assigned' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER user_roles_no_derived BEFORE INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION user_roles_no_derived();
--> statement-breakpoint

-- employment_events: append-only except the status column (scheduled -> applied | cancelled)
CREATE FUNCTION employment_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'employment_events are append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.employee_id, NEW.type, NEW.effective_date, NEW.changes, NEW.reason, NEW.created_at, NEW.created_by)
     IS DISTINCT FROM (OLD.employee_id, OLD.type, OLD.effective_date, OLD.changes, OLD.reason, OLD.created_at, OLD.created_by)
     OR OLD.status <> 'scheduled' THEN
    RAISE EXCEPTION 'only a scheduled employment event may change, and only its status' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER employment_events_guard BEFORE UPDATE OR DELETE ON employment_events
  FOR EACH ROW EXECUTE FUNCTION employment_events_guard();
--> statement-breakpoint

-- approval_steps: immutable once decided (FR-WF-005)
CREATE FUNCTION approval_steps_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.decision <> 'pending' THEN
    RAISE EXCEPTION 'decided approval steps are immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER approval_steps_guard BEFORE UPDATE OR DELETE ON approval_steps
  FOR EACH ROW EXECUTE FUNCTION approval_steps_guard();
--> statement-breakpoint

-- Payroll lock guard (FR-PAY-011): items and lines of a locked (or later) run cannot change;
-- the run itself may only change status, payment and publication fields after locking.
CREATE FUNCTION payroll_run_is_locked(run_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT status IN ('locked', 'paid', 'reconciled') FROM payroll_runs WHERE id = run_id
$$;
--> statement-breakpoint
CREATE FUNCTION payroll_items_locked_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF payroll_run_is_locked(COALESCE(OLD.payroll_run_id, NEW.payroll_run_id)) THEN
    IF TG_OP = 'UPDATE'
       AND (NEW.gross_amount, NEW.deduction_amount, NEW.net_amount, NEW.snapshot, NEW.employee_id, NEW.days_employed)
           IS NOT DISTINCT FROM (OLD.gross_amount, OLD.deduction_amount, OLD.net_amount, OLD.snapshot, OLD.employee_id, OLD.days_employed) THEN
      RETURN NEW; -- payment_status and audit columns may change after locking
    END IF;
    RAISE EXCEPTION 'payroll run is locked' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER payroll_items_locked_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_items
  FOR EACH ROW EXECUTE FUNCTION payroll_items_locked_guard();
--> statement-breakpoint
CREATE FUNCTION payroll_line_items_locked_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run uuid;
BEGIN
  SELECT payroll_run_id INTO run FROM payroll_items WHERE id = COALESCE(OLD.payroll_item_id, NEW.payroll_item_id);
  IF payroll_run_is_locked(run) THEN
    RAISE EXCEPTION 'payroll run is locked' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER payroll_line_items_locked_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_line_items
  FOR EACH ROW EXECUTE FUNCTION payroll_line_items_locked_guard();
--> statement-breakpoint
CREATE FUNCTION payroll_runs_locked_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'only draft payroll runs can be deleted' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('locked', 'paid', 'reconciled')
     AND (NEW.payroll_period_id, NEW.run_number, NEW.run_type, NEW.total_gross, NEW.total_deductions, NEW.total_net,
          NEW.employee_count, NEW.calculated_at, NEW.approved_by, NEW.approved_at, NEW.self_approved, NEW.locked_at)
         IS DISTINCT FROM
         (OLD.payroll_period_id, OLD.run_number, OLD.run_type, OLD.total_gross, OLD.total_deductions, OLD.total_net,
          OLD.employee_count, OLD.calculated_at, OLD.approved_by, OLD.approved_at, OLD.self_approved, OLD.locked_at) THEN
    RAISE EXCEPTION 'payroll run is locked' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payroll_runs_locked_guard BEFORE UPDATE OR DELETE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION payroll_runs_locked_guard();
--> statement-breakpoint

-- salary_structures referenced by a locked payroll item keep their amount and start date (FR-PAY-003)
CREATE FUNCTION salary_structures_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.gross_amount, NEW.effective_from) IS DISTINCT FROM (OLD.gross_amount, OLD.effective_from)
     AND EXISTS (SELECT 1 FROM payroll_items pi JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
                 WHERE pi.salary_structure_id = OLD.id AND pr.status IN ('locked', 'paid', 'reconciled')) THEN
    RAISE EXCEPTION 'salary structure is used by a locked payroll run' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER salary_structures_guard BEFORE UPDATE ON salary_structures
  FOR EACH ROW EXECUTE FUNCTION salary_structures_guard();
--> statement-breakpoint

-- Append-only tables for the application role (DATA-MODEL.md §11). The role exists on Neon (ACCOUNT-SETUP.md);
-- locally and in CI the app connects as the owner, so the grants are skipped there.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrm_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, settings_history, attendance_events,
      leave_ledger_entries, document_versions FROM hrm_app;
    GRANT SELECT, INSERT ON audit_logs, settings_history, attendance_events,
      leave_ledger_entries, document_versions TO hrm_app;
  END IF;
END $$;
