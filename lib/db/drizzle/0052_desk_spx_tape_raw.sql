CREATE TABLE IF NOT EXISTS "desk_spx_tape_raw" (
  "id" serial PRIMARY KEY NOT NULL,
  "session_date" date NOT NULL,
  "chunk_start_ns" bigint NOT NULL,
  "chunk_end_ns" bigint NOT NULL,
  "n_frames" integer NOT NULL,
  "bytes_raw" integer NOT NULL,
  "data" bytea NOT NULL,
  "inserted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "desk_spx_tape_raw_session_chunk_idx" ON "desk_spx_tape_raw" ("session_date", "chunk_start_ns");