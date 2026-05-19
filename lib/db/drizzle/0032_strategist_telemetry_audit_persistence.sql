-- Conviction Desk full audit persistence (Anthropic request/response, tools, web search, thinking)
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "model_input" text;
--> statement-breakpoint
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "system_prompt" text;
--> statement-breakpoint
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "tools_attached" jsonb;
--> statement-breakpoint
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "extended_thinking_config" jsonb;
--> statement-breakpoint
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "raw_api_response" jsonb;
--> statement-breakpoint
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "thinking_blocks" text;
--> statement-breakpoint
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "web_search_queries" jsonb;
--> statement-breakpoint
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "web_search_results" jsonb;
--> statement-breakpoint
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "anthropic_request_id" text;
--> statement-breakpoint
ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "model_name" text;
