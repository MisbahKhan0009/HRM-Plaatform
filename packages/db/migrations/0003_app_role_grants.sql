-- Table grants for the application role (DATABASE-CONVENTIONS.md, DATA-MODEL.md §11). Written by hand.
-- hrm_app gets SELECT, INSERT, UPDATE on business tables; DELETE only on pruned tables and on rows the API removes;
-- append-only tables keep SELECT, INSERT only (0002). The role exists on Neon (ACCOUNT-SETUP.md); locally and in CI
-- the app connects as the owner, so the block is skipped there.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrm_app') THEN
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO hrm_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hrm_app;

    -- Pruned by the maintenance step and Better Auth (sessions, verifications, rate limits, idempotency, outbox).
    GRANT DELETE ON sessions, verifications, rate_limits, idempotency_records, outbox_messages, email_deliveries
      TO hrm_app;
    -- Rows the API removes: passkeys and 2FA (Better Auth), role grants, holidays, draft payroll items and claims.
    GRANT DELETE ON passkeys, two_factors, user_roles, role_permissions, holidays, payroll_items, payroll_line_items,
      reimbursement_claims TO hrm_app;

    -- Append-only tables: undo the UPDATE granted above (same set as 0002).
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, settings_history, attendance_events,
      leave_ledger_entries, document_versions FROM hrm_app;

    -- Tables created by later migrations get the same baseline; each migration adds DELETE or revokes UPDATE itself.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO hrm_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO hrm_app;
  END IF;
END $$;
