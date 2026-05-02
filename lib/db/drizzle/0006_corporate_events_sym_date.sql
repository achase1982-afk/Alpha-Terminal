DROP INDEX IF EXISTS "corp_events_sym";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "corp_events_sym_date" ON "corporate_events" USING btree ("symbol","earnings_date");
