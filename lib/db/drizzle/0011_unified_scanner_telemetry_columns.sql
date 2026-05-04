-- Strategist telemetry: unified scanner handoff columns (comma-separated surfaced_by, flow score, universe id).
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "scanner_surfaced_by" text;
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "scanner_flow_score" integer;
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "scanner_universe" text;
