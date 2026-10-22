CREATE TYPE "public"."adjustment_type" AS ENUM('addition', 'deduction');--> statement-breakpoint
CREATE TYPE "public"."approval_step_decision" AS ENUM('pending', 'approved', 'rejected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."approval_subject_type" AS ENUM('leave_request', 'attendance_correction', 'reimbursement_claim', 'profile_change', 'payroll_run', 'payroll_adjustment');--> statement-breakpoint
CREATE TYPE "public"."attendance_event_type" AS ENUM('check_in', 'check_out', 'manual_entry', 'correction');--> statement-breakpoint
CREATE TYPE "public"."attendance_source" AS ENUM('web', 'manual', 'correction', 'system');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'short_hours', 'missed_core', 'missing_punch', 'absent', 'on_leave', 'holiday', 'weekend', 'not_employed');--> statement-breakpoint
CREATE TYPE "public"."contract_type" AS ENUM('permanent', 'probation', 'fixed_term', 'intern', 'consultant');--> statement-breakpoint
CREATE TYPE "public"."document_category" AS ENUM('identity', 'contract', 'certificate', 'payslip', 'receipt', 'policy', 'other');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('draft', 'preboarding', 'probation', 'active', 'notice_period', 'separated', 'archived');--> statement-breakpoint
CREATE TYPE "public"."employment_event_type" AS ENUM('hired', 'confirmed', 'promoted', 'transferred', 'manager_changed', 'position_changed', 'salary_changed', 'status_changed', 'separated', 'rehired');--> statement-breakpoint
CREATE TYPE "public"."half_day_part" AS ENUM('first_half', 'second_half');--> statement-breakpoint
CREATE TYPE "public"."holiday_type" AS ENUM('public', 'festival', 'company', 'optional');--> statement-breakpoint
CREATE TYPE "public"."leave_ledger_type" AS ENUM('grant', 'accrual', 'reservation', 'reservation_release', 'usage', 'adjustment', 'reversal', 'carry_forward', 'expiry');--> statement-breakpoint
CREATE TYPE "public"."leave_unit" AS ENUM('day', 'half_day');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'cheque');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'paid', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payroll_line_code" AS ENUM('base_salary', 'proration_adjustment', 'reimbursement', 'addition', 'deduction', 'arrears');--> statement-breakpoint
CREATE TYPE "public"."payroll_line_kind" AS ENUM('earning', 'deduction');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_status" AS ENUM('draft', 'calculated', 'submitted', 'returned', 'approved', 'locked', 'paid', 'reconciled');--> statement-breakpoint
CREATE TYPE "public"."setting_scope" AS ENUM('technical', 'hr', 'payroll');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('ink', 'paper');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'suspended', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'sent', 'failed', 'dead');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invitations_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "permissions_code_fmt" CHECK ("permissions"."code" ~ '^[a-z_]+(\.[a-z_]+){1,3}$')
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_code" text NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_code_pk" PRIMARY KEY("role_id","permission_code")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_derived" boolean DEFAULT false NOT NULL,
	"requires_strong_auth" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "roles_code_uq" UNIQUE("company_id","code"),
	CONSTRAINT "roles_code_fmt" CHECK ("roles"."code" ~ '^[a-z_]{3,40}$')
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"subject_type" "approval_subject_type" NOT NULL,
	"leave_request_id" uuid,
	"attendance_correction_id" uuid,
	"reimbursement_claim_id" uuid,
	"profile_change_request_id" uuid,
	"payroll_run_id" uuid,
	"payroll_adjustment_id" uuid,
	"requester_user_id" uuid NOT NULL,
	"subject_employee_id" uuid,
	"state" text DEFAULT 'open' NOT NULL,
	"current_step" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "approval_requests_state" CHECK ("approval_requests"."state" IN ('open', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "approval_requests_one_subject" CHECK (num_nonnulls("approval_requests"."leave_request_id", "approval_requests"."attendance_correction_id", "approval_requests"."reimbursement_claim_id", "approval_requests"."profile_change_request_id", "approval_requests"."payroll_run_id", "approval_requests"."payroll_adjustment_id") = 1),
	CONSTRAINT "approval_requests_subject_match" CHECK ((("approval_requests"."subject_type" = 'leave_request') = ("approval_requests"."leave_request_id" IS NOT NULL))
        AND (("approval_requests"."subject_type" = 'attendance_correction') = ("approval_requests"."attendance_correction_id" IS NOT NULL))
        AND (("approval_requests"."subject_type" = 'reimbursement_claim') = ("approval_requests"."reimbursement_claim_id" IS NOT NULL))
        AND (("approval_requests"."subject_type" = 'profile_change') = ("approval_requests"."profile_change_request_id" IS NOT NULL))
        AND (("approval_requests"."subject_type" = 'payroll_run') = ("approval_requests"."payroll_run_id" IS NOT NULL))
        AND (("approval_requests"."subject_type" = 'payroll_adjustment') = ("approval_requests"."payroll_adjustment_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"sequence" smallint NOT NULL,
	"approver_user_id" uuid,
	"approver_permission" text,
	"decision" "approval_step_decision" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"comment" text,
	"on_behalf" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_steps_seq_uq" UNIQUE("approval_request_id","sequence"),
	CONSTRAINT "approval_steps_seq" CHECK ("approval_steps"."sequence" > 0),
	CONSTRAINT "approval_steps_approver" CHECK ("approval_steps"."approver_user_id" IS NOT NULL OR "approval_steps"."approver_permission" IS NOT NULL),
	CONSTRAINT "approval_steps_decided" CHECK ("approval_steps"."decision" = 'pending' OR ("approval_steps"."decided_by" IS NOT NULL AND "approval_steps"."decided_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "attendance_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed_check_in_at" timestamp with time zone,
	"proposed_check_out_at" timestamp with time zone,
	"reason" text NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "attendance_corrections_status" CHECK ("attendance_corrections"."status" IN ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "attendance_corrections_reason" CHECK (length("attendance_corrections"."reason") BETWEEN 5 AND 1000),
	CONSTRAINT "attendance_corrections_has_time" CHECK ("attendance_corrections"."proposed_check_in_at" IS NOT NULL OR "attendance_corrections"."proposed_check_out_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "attendance_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"type" "attendance_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "attendance_source" NOT NULL,
	"check_in_at" timestamp with time zone,
	"check_out_at" timestamp with time zone,
	"correction_id" uuid,
	"reason" text,
	"ip_address" "inet",
	"user_agent" text,
	"recorded_by" uuid,
	CONSTRAINT "attendance_events_reason" CHECK ("attendance_events"."type" NOT IN ('manual_entry', 'correction') OR "attendance_events"."reason" IS NOT NULL),
	CONSTRAINT "attendance_events_correction" CHECK ("attendance_events"."type" <> 'correction' OR "attendance_events"."correction_id" IS NOT NULL),
	CONSTRAINT "attendance_events_order" CHECK ("attendance_events"."check_out_at" IS NULL OR "attendance_events"."check_in_at" IS NULL OR "attendance_events"."check_out_at" > "attendance_events"."check_in_at")
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"work_schedule_id" uuid,
	"first_in_at" timestamp with time zone,
	"last_out_at" timestamp with time zone,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"early_leave_minutes" integer DEFAULT 0 NOT NULL,
	"status" "attendance_status" NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"has_correction" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "attendance_records_day_uq" UNIQUE("employee_id","work_date"),
	CONSTRAINT "attendance_records_nonneg" CHECK ("attendance_records"."worked_minutes" >= 0 AND "attendance_records"."late_minutes" >= 0 AND "attendance_records"."early_leave_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "schedule_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_schedule_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "schedule_assignments_dates" CHECK ("schedule_assignments"."effective_to" IS NULL OR "schedule_assignments"."effective_to" >= "schedule_assignments"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_provider_uq" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone,
	"aaguid" text,
	CONSTRAINT "passkeys_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"strong_auth_at" timestamp with time zone,
	"auth_method" text,
	CONSTRAINT "sessions_token_unique" UNIQUE("token"),
	CONSTRAINT "sessions_auth_method" CHECK ("sessions"."auth_method" IS NULL OR "sessions"."auth_method" IN ('passkey', 'email_otp'))
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone,
	CONSTRAINT "two_factors_userId_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"logo_document_id" uuid,
	"email" "citext",
	"phone" text,
	"address" text,
	"timezone" text DEFAULT 'Asia/Dhaka' NOT NULL,
	"currency" char(3) DEFAULT 'BDT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "companies_name_len" CHECK (length("companies"."name") BETWEEN 1 AND 200),
	CONSTRAINT "companies_currency_fmt" CHECK ("companies"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "code_sequences" (
	"company_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "code_sequences_company_id_scope_pk" PRIMARY KEY("company_id","scope"),
	CONSTRAINT "code_sequences_scope" CHECK ("code_sequences"."scope" IN ('employee', 'leave_request', 'reimbursement_claim', 'payroll_run')),
	CONSTRAINT "code_sequences_positive" CHECK ("code_sequences"."next_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" uuid,
	CONSTRAINT "document_versions_storageKey_unique" UNIQUE("storage_key"),
	CONSTRAINT "document_versions_uq" UNIQUE("document_id","version"),
	CONSTRAINT "document_versions_positive" CHECK ("document_versions"."version" > 0),
	CONSTRAINT "document_versions_mime" CHECK ("document_versions"."mime_type" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "document_versions_size" CHECK ("document_versions"."size_bytes" BETWEEN 1 AND 10485760)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid,
	"category" "document_category" NOT NULL,
	"title" text NOT NULL,
	"is_restricted" boolean DEFAULT false NOT NULL,
	"issue_date" date,
	"expiry_date" date,
	"current_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "documents_dates" CHECK ("documents"."expiry_date" IS NULL OR "documents"."issue_date" IS NULL OR "documents"."expiry_date" >= "documents"."issue_date"),
	CONSTRAINT "documents_status" CHECK ("documents"."status" IN ('active', 'deleted')),
	CONSTRAINT "documents_deleted_fields" CHECK ("documents"."status" <> 'deleted' OR ("documents"."deleted_at" IS NOT NULL AND "documents"."deleted_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "employee_contacts" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"personal_email" "citext",
	"personal_phone" text,
	"present_address" text,
	"permanent_address" text,
	"national_id_number" text,
	"emergency_contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "employee_contacts_emergency_array" CHECK (jsonb_typeof("employee_contacts"."emergency_contacts") = 'array')
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid,
	"employee_code" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"preferred_name" text,
	"work_email" "citext",
	"work_phone" text,
	"date_of_birth" date,
	"gender" text,
	"status" "employee_status" DEFAULT 'draft' NOT NULL,
	"department_id" uuid,
	"position_id" uuid,
	"manager_id" uuid,
	"joining_date" date,
	"probation_end_date" date,
	"separation_date" date,
	"separation_type" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "employees_userId_unique" UNIQUE("user_id"),
	CONSTRAINT "employees_code_uq" UNIQUE("company_id","employee_code"),
	CONSTRAINT "employees_not_self_manager" CHECK ("employees"."manager_id" IS NULL OR "employees"."manager_id" <> "employees"."id"),
	CONSTRAINT "employees_joining_required" CHECK ("employees"."status" IN ('draft', 'preboarding') OR "employees"."joining_date" IS NOT NULL),
	CONSTRAINT "employees_separation_after_joining" CHECK ("employees"."separation_date" IS NULL OR "employees"."joining_date" IS NULL OR "employees"."separation_date" >= "employees"."joining_date"),
	CONSTRAINT "employees_gender" CHECK ("employees"."gender" IS NULL OR "employees"."gender" IN ('female', 'male', 'other', 'undisclosed')),
	CONSTRAINT "employees_separation_type" CHECK ("employees"."separation_type" IS NULL OR "employees"."separation_type" IN ('resignation', 'termination', 'contract_end', 'retirement', 'death', 'other'))
);
--> statement-breakpoint
CREATE TABLE "employment_contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "contract_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"document_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "employment_contracts_dates" CHECK ("employment_contracts"."end_date" IS NULL OR "employment_contracts"."end_date" >= "employment_contracts"."start_date"),
	CONSTRAINT "employment_contracts_fixed_term" CHECK ("employment_contracts"."type" <> 'fixed_term' OR "employment_contracts"."end_date" IS NOT NULL),
	CONSTRAINT "employment_contracts_status" CHECK ("employment_contracts"."status" IN ('draft', 'active', 'expired', 'terminated', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "employment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "employment_event_type" NOT NULL,
	"effective_date" date NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"changes" jsonb NOT NULL,
	"reason" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "employment_events_status" CHECK ("employment_events"."status" IN ('scheduled', 'applied', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "profile_change_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"changes" jsonb NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "profile_change_requests_status" CHECK ("profile_change_requests"."status" IN ('pending', 'approved', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"leave_year" smallint NOT NULL,
	"company_id" uuid NOT NULL,
	"entitled" numeric(6, 2) DEFAULT '0' NOT NULL,
	"used" numeric(6, 2) DEFAULT '0' NOT NULL,
	"reserved" numeric(6, 2) DEFAULT '0' NOT NULL,
	"adjusted" numeric(6, 2) DEFAULT '0' NOT NULL,
	"available" numeric(6, 2) GENERATED ALWAYS AS (entitled - used - reserved + adjusted) STORED,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "leave_balances_employee_id_leave_type_id_leave_year_pk" PRIMARY KEY("employee_id","leave_type_id","leave_year")
);
--> statement-breakpoint
CREATE TABLE "leave_ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"leave_year" smallint NOT NULL,
	"type" "leave_ledger_type" NOT NULL,
	"amount" numeric(6, 2) NOT NULL,
	"effective_date" date NOT NULL,
	"leave_request_id" uuid,
	"reverses_entry_id" uuid,
	"policy_id" uuid,
	"job_run_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "leave_ledger_year" CHECK ("leave_ledger_entries"."leave_year" BETWEEN 2000 AND 2100),
	CONSTRAINT "leave_ledger_nonzero" CHECK ("leave_ledger_entries"."amount" <> 0),
	CONSTRAINT "leave_ledger_request_ref" CHECK ("leave_ledger_entries"."type" NOT IN ('reservation', 'reservation_release', 'usage', 'reversal') OR "leave_ledger_entries"."leave_request_id" IS NOT NULL),
	CONSTRAINT "leave_ledger_adjustment_reason" CHECK ("leave_ledger_entries"."type" <> 'adjustment' OR "leave_ledger_entries"."reason" IS NOT NULL),
	CONSTRAINT "leave_ledger_sign" CHECK (("leave_ledger_entries"."type" IN ('reservation', 'usage', 'expiry') AND "leave_ledger_entries"."amount" < 0) OR ("leave_ledger_entries"."type" IN ('grant', 'accrual', 'reservation_release', 'reversal', 'carry_forward') AND "leave_ledger_entries"."amount" > 0) OR "leave_ledger_entries"."type" = 'adjustment')
);
--> statement-breakpoint
CREATE TABLE "leave_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"allocation_method" text NOT NULL,
	"annual_entitlement" numeric(6, 2),
	"accrual_per_month" numeric(6, 2),
	"days_worked_per_unit" numeric(6, 2),
	"prorate_first_year" boolean DEFAULT true NOT NULL,
	"eligibility_after_days" integer DEFAULT 0 NOT NULL,
	"eligible_statuses" "employee_status"[] DEFAULT '{probation,active,notice_period}' NOT NULL,
	"max_carry_forward" numeric(6, 2),
	"max_balance" numeric(6, 2),
	"carry_forward_expiry_months" integer,
	"allow_negative_balance" boolean DEFAULT false NOT NULL,
	"max_consecutive_days" numeric(6, 2),
	"min_notice_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "leave_policies_method" CHECK ("leave_policies"."allocation_method" IN ('annual_grant', 'monthly_accrual', 'per_days_worked', 'manual')),
	CONSTRAINT "leave_policies_dates" CHECK ("leave_policies"."effective_to" IS NULL OR "leave_policies"."effective_to" >= "leave_policies"."effective_from"),
	CONSTRAINT "leave_policies_nonneg" CHECK (coalesce("leave_policies"."annual_entitlement", 0) >= 0 AND coalesce("leave_policies"."accrual_per_month", 0) >= 0 AND coalesce("leave_policies"."max_carry_forward", 0) >= 0 AND coalesce("leave_policies"."max_balance", 0) >= 0 AND "leave_policies"."eligibility_after_days" >= 0),
	CONSTRAINT "leave_policies_days_worked" CHECK ("leave_policies"."days_worked_per_unit" IS NULL OR "leave_policies"."days_worked_per_unit" > 0),
	CONSTRAINT "leave_policies_cf_expiry" CHECK ("leave_policies"."carry_forward_expiry_months" IS NULL OR "leave_policies"."carry_forward_expiry_months" BETWEEN 1 AND 24)
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"request_number" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"leave_policy_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"unit" "leave_unit" DEFAULT 'day' NOT NULL,
	"half_day_part" "half_day_part",
	"requested_units" numeric(6, 2) NOT NULL,
	"reason" text,
	"attachment_document_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_comment" text,
	"cancellation_reason" text,
	"on_behalf_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "leave_requests_number_uq" UNIQUE("company_id","request_number"),
	CONSTRAINT "leave_requests_dates" CHECK ("leave_requests"."end_date" >= "leave_requests"."start_date"),
	CONSTRAINT "leave_requests_units" CHECK ("leave_requests"."requested_units" > 0),
	CONSTRAINT "leave_requests_half_day" CHECK ("leave_requests"."unit" = 'day' OR ("leave_requests"."start_date" = "leave_requests"."end_date" AND "leave_requests"."half_day_part" IS NOT NULL AND "leave_requests"."requested_units" = 0.5)),
	CONSTRAINT "leave_requests_half_part" CHECK ("leave_requests"."unit" = 'half_day' OR "leave_requests"."half_day_part" IS NULL),
	CONSTRAINT "leave_requests_status" CHECK ("leave_requests"."status" IN ('draft', 'pending', 'approved', 'rejected', 'withdrawn', 'cancellation_pending', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"allows_half_day" boolean DEFAULT true NOT NULL,
	"requires_reason" boolean DEFAULT false NOT NULL,
	"requires_document_after_days" numeric(6, 2),
	"color_token" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "leave_types_code_uq" UNIQUE("company_id","code"),
	CONSTRAINT "leave_types_code_fmt" CHECK ("leave_types"."code" ~ '^[A-Z]{2,10}$')
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"head_employee_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "departments_code_uq" UNIQUE("company_id","code"),
	CONSTRAINT "departments_code_fmt" CHECK ("departments"."code" ~ '^[A-Z0-9-]{2,20}$')
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"type" "holiday_type" DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "holidays_date_uq" UNIQUE("company_id","date")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"department_id" uuid,
	"title" text NOT NULL,
	"grade" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Dhaka' NOT NULL,
	"working_days" smallint[] DEFAULT '{0,1,2,3,4}' NOT NULL,
	"core_start" time NOT NULL,
	"core_end" time NOT NULL,
	"min_daily_minutes" integer NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "work_schedules_core" CHECK ("work_schedules"."core_end" > "work_schedules"."core_start"),
	CONSTRAINT "work_schedules_min" CHECK ("work_schedules"."min_daily_minutes" BETWEEN 0 AND 1440),
	CONSTRAINT "work_schedules_break" CHECK ("work_schedules"."break_minutes" BETWEEN 0 AND 480),
	CONSTRAINT "work_schedules_days" CHECK ("work_schedules"."working_days" <@ '{0,1,2,3,4,5,6}'::smallint[] AND cardinality("work_schedules"."working_days") BETWEEN 1 AND 7)
);
--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "adjustment_type" NOT NULL,
	"line_code" "payroll_line_code" DEFAULT 'addition' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reason" text NOT NULL,
	"target_period_id" uuid NOT NULL,
	"corrects_payroll_item_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"self_approved" boolean DEFAULT false NOT NULL,
	"self_approval_note" text,
	"applied_payroll_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_adjustments_line_code" CHECK ("payroll_adjustments"."line_code" IN ('addition', 'deduction', 'arrears')),
	CONSTRAINT "payroll_adjustments_amount" CHECK ("payroll_adjustments"."amount" > 0),
	CONSTRAINT "payroll_adjustments_reason" CHECK (length("payroll_adjustments"."reason") BETWEEN 5 AND 1000),
	CONSTRAINT "payroll_adjustments_status" CHECK ("payroll_adjustments"."status" IN ('pending', 'approved', 'rejected', 'applied')),
	CONSTRAINT "payroll_adjustments_applied" CHECK ("payroll_adjustments"."status" <> 'applied' OR "payroll_adjustments"."applied_payroll_item_id" IS NOT NULL),
	CONSTRAINT "payroll_adjustments_self" CHECK (NOT "payroll_adjustments"."self_approved" OR "payroll_adjustments"."self_approval_note" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "payroll_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"salary_structure_id" uuid,
	"currency" char(3) DEFAULT 'BDT' NOT NULL,
	"gross_amount" numeric(14, 2) NOT NULL,
	"deduction_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(14, 2) NOT NULL,
	"days_in_period" smallint NOT NULL,
	"days_employed" smallint NOT NULL,
	"snapshot" jsonb NOT NULL,
	"validation_flags" text[] DEFAULT '{}' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_items_employee_uq" UNIQUE("payroll_run_id","employee_id"),
	CONSTRAINT "payroll_items_net" CHECK ("payroll_items"."net_amount" = "payroll_items"."gross_amount" - "payroll_items"."deduction_amount"),
	CONSTRAINT "payroll_items_days" CHECK ("payroll_items"."days_employed" BETWEEN 0 AND "payroll_items"."days_in_period"),
	CONSTRAINT "payroll_items_payment_status" CHECK ("payroll_items"."payment_status" IN ('unpaid', 'paid', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "payroll_line_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payroll_item_id" uuid NOT NULL,
	"kind" "payroll_line_kind" NOT NULL,
	"code" "payroll_line_code" NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"calculation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_line_items_amount" CHECK ("payroll_line_items"."amount" >= 0),
	CONSTRAINT "payroll_line_items_source" CHECK ("payroll_line_items"."source_type" IS NULL OR "payroll_line_items"."source_type" IN ('salary_structure', 'reimbursement_claim', 'payroll_adjustment'))
);
--> statement-breakpoint
CREATE TABLE "payroll_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"payroll_item_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_on" date NOT NULL,
	"cheque_number" text,
	"reference" text,
	"acknowledged_by_name" text,
	"acknowledgment_document_id" uuid,
	"status" "payment_status" DEFAULT 'paid' NOT NULL,
	"cancelled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_payments_amount" CHECK ("payroll_payments"."amount" > 0),
	CONSTRAINT "payroll_payments_cheque" CHECK ("payroll_payments"."method" <> 'cheque' OR "payroll_payments"."cheque_number" IS NOT NULL),
	CONSTRAINT "payroll_payments_cancelled" CHECK ("payroll_payments"."status" <> 'cancelled' OR "payroll_payments"."cancelled_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_periods_uq" UNIQUE("company_id","year","month"),
	CONSTRAINT "payroll_periods_year" CHECK ("payroll_periods"."year" BETWEEN 2000 AND 2100),
	CONSTRAINT "payroll_periods_month" CHECK ("payroll_periods"."month" BETWEEN 1 AND 12),
	CONSTRAINT "payroll_periods_dates" CHECK ("payroll_periods"."end_date" >= "payroll_periods"."start_date"),
	CONSTRAINT "payroll_periods_status" CHECK ("payroll_periods"."status" IN ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"run_number" text NOT NULL,
	"run_type" text DEFAULT 'regular' NOT NULL,
	"status" "payroll_run_status" DEFAULT 'draft' NOT NULL,
	"calculation_rule_version" text,
	"calculated_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"prepared_by" uuid,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"self_approved" boolean DEFAULT false NOT NULL,
	"self_approval_note" text,
	"returned_reason" text,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"payslips_published_at" timestamp with time zone,
	"total_gross" numeric(14, 2),
	"total_deductions" numeric(14, 2),
	"total_net" numeric(14, 2),
	"employee_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_runs_number_uq" UNIQUE("company_id","run_number"),
	CONSTRAINT "payroll_runs_type" CHECK ("payroll_runs"."run_type" IN ('regular', 'off_cycle')),
	CONSTRAINT "payroll_runs_self_approval" CHECK (NOT "payroll_runs"."self_approved" OR "payroll_runs"."self_approval_note" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"payroll_item_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	"first_viewed_at" timestamp with time zone,
	CONSTRAINT "payslips_payrollItemId_unique" UNIQUE("payroll_item_id")
);
--> statement-breakpoint
CREATE TABLE "salary_structures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"currency" char(3) DEFAULT 'BDT' NOT NULL,
	"gross_amount" numeric(14, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"reason" text,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "salary_structures_gross" CHECK ("salary_structures"."gross_amount" >= 0),
	CONSTRAINT "salary_structures_dates" CHECK ("salary_structures"."effective_to" IS NULL OR "salary_structures"."effective_to" >= "salary_structures"."effective_from"),
	CONSTRAINT "salary_structures_status" CHECK ("salary_structures"."status" IN ('draft', 'approved', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"category" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"employee_id" uuid,
	"request_id" text,
	"ip_address" "inet",
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_logs_actor_type" CHECK ("audit_logs"."actor_type" IN ('user', 'system')),
	CONSTRAINT "audit_logs_action_fmt" CHECK ("audit_logs"."action" ~ '^[a-z_]+\.[a-z_.]+$'),
	CONSTRAINT "audit_logs_category" CHECK ("audit_logs"."category" IN ('business', 'payroll', 'security', 'technical'))
);
--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outbox_message_id" uuid,
	"template" text NOT NULL,
	"to_address" "citext" NOT NULL,
	"provider" text DEFAULT 'gmail' NOT NULL,
	"provider_message_id" text,
	"status" text NOT NULL,
	"error" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_deliveries_status" CHECK ("email_deliveries"."status" IN ('sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"operation" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_uq" UNIQUE("user_id","idempotency_key","operation"),
	CONSTRAINT "idempotency_key_len" CHECK (length("idempotency_records"."idempotency_key") BETWEEN 8 AND 100),
	CONSTRAINT "idempotency_status" CHECK ("idempotency_records"."status" IN ('in_progress', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"job" text NOT NULL,
	"run_key" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items" integer DEFAULT 0 NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	CONSTRAINT "job_runs_once_uq" UNIQUE("company_id","job","run_key"),
	CONSTRAINT "job_runs_status" CHECK ("job_runs"."status" IN ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "outbox_attempts_nonneg" CHECK ("outbox_messages"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"scope" "setting_scope" NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "settings_company_id_key_pk" PRIMARY KEY("company_id","key"),
	CONSTRAINT "settings_key_fmt" CHECK ("settings"."key" ~ '^[a-z][a-z0-9_.]{2,99}$')
);
--> statement-breakpoint
CREATE TABLE "settings_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reimbursement_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"claim_number" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"category" text DEFAULT 'transport' NOT NULL,
	"expense_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" char(3) DEFAULT 'BDT' NOT NULL,
	"description" text NOT NULL,
	"receipt_document_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_comment" text,
	"payroll_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "reimbursement_claims_number_uq" UNIQUE("company_id","claim_number"),
	CONSTRAINT "reimbursement_claims_category" CHECK ("reimbursement_claims"."category" IN ('transport')),
	CONSTRAINT "reimbursement_claims_amount" CHECK ("reimbursement_claims"."amount" > 0),
	CONSTRAINT "reimbursement_claims_description" CHECK (length("reimbursement_claims"."description") BETWEEN 3 AND 1000),
	CONSTRAINT "reimbursement_claims_status" CHECK ("reimbursement_claims"."status" IN ('draft', 'submitted', 'approved', 'rejected', 'withdrawn', 'included', 'paid')),
	CONSTRAINT "reimbursement_claims_payroll_ref" CHECK ("reimbursement_claims"."status" NOT IN ('included', 'paid') OR "reimbursement_claims"."payroll_item_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"theme" "theme" DEFAULT 'ink' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_locale" CHECK ("users"."locale" IN ('en', 'bn'))
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_subject_employee_id_employees_id_fk" FOREIGN KEY ("subject_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_attendance_correction_fk" FOREIGN KEY ("attendance_correction_id") REFERENCES "public"."attendance_corrections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reimbursement_claim_fk" FOREIGN KEY ("reimbursement_claim_id") REFERENCES "public"."reimbursement_claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_profile_change_fk" FOREIGN KEY ("profile_change_request_id") REFERENCES "public"."profile_change_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_payroll_adjustment_fk" FOREIGN KEY ("payroll_adjustment_id") REFERENCES "public"."payroll_adjustments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_permission_permissions_code_fk" FOREIGN KEY ("approver_permission") REFERENCES "public"."permissions"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_correction_id_attendance_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "public"."attendance_corrections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_work_schedule_id_work_schedules_id_fk" FOREIGN KEY ("work_schedule_id") REFERENCES "public"."work_schedules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_assignments" ADD CONSTRAINT "schedule_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_assignments" ADD CONSTRAINT "schedule_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_assignments" ADD CONSTRAINT "schedule_assignments_work_schedule_id_work_schedules_id_fk" FOREIGN KEY ("work_schedule_id") REFERENCES "public"."work_schedules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_assignments" ADD CONSTRAINT "schedule_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_assignments" ADD CONSTRAINT "schedule_assignments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_sequences" ADD CONSTRAINT "code_sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_contacts" ADD CONSTRAINT "employee_contacts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_contacts" ADD CONSTRAINT "employee_contacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_contacts" ADD CONSTRAINT "employee_contacts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_events" ADD CONSTRAINT "employment_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_events" ADD CONSTRAINT "employment_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_events" ADD CONSTRAINT "employment_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_policy_id_leave_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."leave_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_job_run_id_job_runs_id_fk" FOREIGN KEY ("job_run_id") REFERENCES "public"."job_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_reverses_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."leave_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_policy_id_leave_policies_id_fk" FOREIGN KEY ("leave_policy_id") REFERENCES "public"."leave_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_attachment_document_id_documents_id_fk" FOREIGN KEY ("attachment_document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_on_behalf_by_users_id_fk" FOREIGN KEY ("on_behalf_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_target_period_id_payroll_periods_id_fk" FOREIGN KEY ("target_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_applied_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("applied_payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_corrects_item_fk" FOREIGN KEY ("corrects_payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_salary_structure_id_salary_structures_id_fk" FOREIGN KEY ("salary_structure_id") REFERENCES "public"."salary_structures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line_items" ADD CONSTRAINT "payroll_line_items_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_acknowledgment_document_id_documents_id_fk" FOREIGN KEY ("acknowledgment_document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_outbox_message_id_outbox_messages_id_fk" FOREIGN KEY ("outbox_message_id") REFERENCES "public"."outbox_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_history" ADD CONSTRAINT "settings_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_history" ADD CONSTRAINT "settings_history_company_id_key_settings_company_id_key_fk" FOREIGN KEY ("company_id","key") REFERENCES "public"."settings"("company_id","key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_receipt_document_id_documents_id_fk" FOREIGN KEY ("receipt_document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_user_idx" ON "invitations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "approval_requests_state_idx" ON "approval_requests" USING btree ("company_id","state","subject_type");--> statement-breakpoint
CREATE INDEX "approval_steps_inbox_user_idx" ON "approval_steps" USING btree ("approver_user_id") WHERE "approval_steps"."decision" = 'pending';--> statement-breakpoint
CREATE INDEX "approval_steps_inbox_perm_idx" ON "approval_steps" USING btree ("approver_permission") WHERE "approval_steps"."decision" = 'pending';--> statement-breakpoint
CREATE INDEX "attendance_corrections_employee_idx" ON "attendance_corrections" USING btree ("employee_id","work_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_corrections_pending_uq" ON "attendance_corrections" USING btree ("employee_id","work_date") WHERE "attendance_corrections"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "attendance_events_day_idx" ON "attendance_events" USING btree ("employee_id","work_date","recorded_at");--> statement-breakpoint
CREATE INDEX "attendance_records_date_idx" ON "attendance_records" USING btree ("company_id","work_date","status");--> statement-breakpoint
CREATE INDEX "schedule_assignments_employee_idx" ON "schedule_assignments" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkeys_user_idx" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "two_factors_secret_idx" ON "two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "documents_employee_idx" ON "documents" USING btree ("employee_id","category");--> statement-breakpoint
CREATE INDEX "documents_expiry_idx" ON "documents" USING btree ("expiry_date") WHERE "documents"."status" = 'active' AND "documents"."expiry_date" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_work_email_uq" ON "employees" USING btree ("company_id","work_email") WHERE "employees"."work_email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "employees_manager_idx" ON "employees" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "employees_department_idx" ON "employees" USING btree ("company_id","department_id");--> statement-breakpoint
CREATE INDEX "employees_status_idx" ON "employees" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "employment_contracts_employee_idx" ON "employment_contracts" USING btree ("employee_id","start_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "employment_contracts_expiry_idx" ON "employment_contracts" USING btree ("end_date") WHERE "employment_contracts"."status" = 'active' AND "employment_contracts"."end_date" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "employment_events_employee_idx" ON "employment_events" USING btree ("employee_id","effective_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "employment_events_due_idx" ON "employment_events" USING btree ("effective_date") WHERE "employment_events"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "profile_change_requests_employee_idx" ON "profile_change_requests" USING btree ("employee_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "profile_change_requests_one_pending_uq" ON "profile_change_requests" USING btree ("employee_id") WHERE "profile_change_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "leave_ledger_balance_idx" ON "leave_ledger_entries" USING btree ("employee_id","leave_type_id","leave_year");--> statement-breakpoint
CREATE INDEX "leave_ledger_request_idx" ON "leave_ledger_entries" USING btree ("leave_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_ledger_accrual_once_uq" ON "leave_ledger_entries" USING btree ("employee_id","leave_type_id","type","effective_date") WHERE "leave_ledger_entries"."type" IN ('accrual', 'carry_forward', 'expiry');--> statement-breakpoint
CREATE INDEX "leave_requests_employee_idx" ON "leave_requests" USING btree ("employee_id","start_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leave_requests_status_idx" ON "leave_requests" USING btree ("company_id","status","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_name_uq" ON "departments" USING btree ("company_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "positions_title_uq" ON "positions" USING btree ("company_id",coalesce("department_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("title"));--> statement-breakpoint
CREATE UNIQUE INDEX "work_schedules_default_uq" ON "work_schedules" USING btree ("company_id") WHERE "work_schedules"."is_default";--> statement-breakpoint
CREATE INDEX "payroll_adjustments_period_idx" ON "payroll_adjustments" USING btree ("target_period_id","status");--> statement-breakpoint
CREATE INDEX "payroll_items_employee_idx" ON "payroll_items" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "payroll_line_items_item_idx" ON "payroll_line_items" USING btree ("payroll_item_id","sort_order");--> statement-breakpoint
CREATE INDEX "payroll_payments_item_idx" ON "payroll_payments" USING btree ("payroll_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_payments_cheque_uq" ON "payroll_payments" USING btree ("company_id","cheque_number") WHERE "payroll_payments"."cheque_number" IS NOT NULL AND "payroll_payments"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_one_regular_uq" ON "payroll_runs" USING btree ("payroll_period_id") WHERE "payroll_runs"."run_type" = 'regular';--> statement-breakpoint
CREATE INDEX "payroll_runs_status_idx" ON "payroll_runs" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "payslips_employee_idx" ON "payslips" USING btree ("employee_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "salary_structures_employee_idx" ON "salary_structures" USING btree ("employee_id","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_idx" ON "audit_logs" USING btree ("company_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("company_id","action","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_employee_idx" ON "audit_logs" USING btree ("employee_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_deliveries_outbox_idx" ON "email_deliveries" USING btree ("outbox_message_id");--> statement-breakpoint
CREATE INDEX "idempotency_expiry_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "job_runs_recent_idx" ON "job_runs" USING btree ("job","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_dedupe_uq" ON "outbox_messages" USING btree ("company_id","dedupe_key") WHERE "outbox_messages"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_due_idx" ON "outbox_messages" USING btree ("next_attempt_at") WHERE "outbox_messages"."status" IN ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "settings_history_key_idx" ON "settings_history" USING btree ("company_id","key","changed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reimbursement_claims_employee_idx" ON "reimbursement_claims" USING btree ("employee_id","expense_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reimbursement_claims_status_idx" ON "reimbursement_claims" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("company_id","status");