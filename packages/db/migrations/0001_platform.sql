CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'sent', 'failed', 'dead');--> statement-breakpoint
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
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_outbox_message_id_outbox_messages_id_fk" FOREIGN KEY ("outbox_message_id") REFERENCES "public"."outbox_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_deliveries_outbox_idx" ON "email_deliveries" USING btree ("outbox_message_id");--> statement-breakpoint
CREATE INDEX "job_runs_recent_idx" ON "job_runs" USING btree ("job","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_dedupe_uq" ON "outbox_messages" USING btree ("company_id","dedupe_key") WHERE "outbox_messages"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_due_idx" ON "outbox_messages" USING btree ("next_attempt_at") WHERE "outbox_messages"."status" IN ('pending', 'failed');