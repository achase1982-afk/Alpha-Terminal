CREATE TABLE IF NOT EXISTS "analyst_price_targets" (
  "ticker" text PRIMARY KEY NOT NULL,
  "target_high" numeric,
  "target_low" numeric,
  "target_median" numeric,
  "target_consensus" numeric,
  "num_analysts" integer,
  "as_of_date" date,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analyst_grades" (
  "id" serial PRIMARY KEY NOT NULL,
  "ticker" text NOT NULL,
  "action_date" date NOT NULL,
  "action" text NOT NULL,
  "grading_company" text,
  "previous_grade" text,
  "new_grade" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "analyst_grades_ticker_action_unique" UNIQUE("ticker","action_date","grading_company","action")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ag_ticker_date" ON "analyst_grades" ("ticker","action_date" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "earnings_surprises_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "ticker" text NOT NULL,
  "report_date" date NOT NULL,
  "eps_estimate" numeric,
  "eps_actual" numeric,
  "surprise_pct" numeric,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "earnings_surprises_history_ticker_report_unique" UNIQUE("ticker","report_date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_esh_ticker_date" ON "earnings_surprises_history" ("ticker","report_date" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "macro_calendar" (
  "id" serial PRIMARY KEY NOT NULL,
  "event_date" date NOT NULL,
  "event_time" text,
  "country" text NOT NULL,
  "event" text NOT NULL,
  "impact" text,
  "actual" numeric,
  "previous" numeric,
  "estimate" numeric,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "macro_calendar_date_country_event_unique" UNIQUE("event_date","country","event")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_macro_calendar_event_date" ON "macro_calendar" ("event_date" DESC);
--> statement-breakpoint
ALTER TABLE "corporate_events" ADD COLUMN IF NOT EXISTS "earnings_time_raw" text;
