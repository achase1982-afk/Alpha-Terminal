ALTER TABLE "corporate_events" ADD COLUMN IF NOT EXISTS "earnings_eps_estimate" double precision;--> statement-breakpoint
ALTER TABLE "corporate_events" ADD COLUMN IF NOT EXISTS "earnings_revenue_estimate" double precision;
