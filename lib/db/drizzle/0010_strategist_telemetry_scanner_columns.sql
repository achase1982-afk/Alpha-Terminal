-- Strategist telemetry: scanner handoff columns for correlation analysis.
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "scanner_source" text;
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "scanner_score" integer;
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "scanner_mode" text;
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "scanner_edge_type" text;
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "scanner_directional_lean" text;
