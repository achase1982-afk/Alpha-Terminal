import { db, aiLabIdeasTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import seedDataRaw from "./aiLabSeedData.json";

interface AiLabSeedEmbeddingRow {
  id: number;
  idea_id: number;
  embedding: unknown;
  tags?: unknown;
  created_at: string;
}

/** Row shape from `aiLabSeedData.json` ideas array (snake_case keys). */
interface AiLabSeedIdea {
  id: number;
  created_at: string;
  origin_type: string;
  analyst_model_name: string;
  critic_model_name: string;
  symbol: string;
  direction: string;
  instrument_type: string;
  option_structure_type: string | null;
  legs: unknown;
  entry_zone: unknown;
  soft_stop: number | null;
  target_zone: unknown;
  time_horizon: string;
  thesis: string;
  catalyst: string;
  invalidation: string;
  regime_fit: string;
  main_signals: unknown;
  scanner_alignment_at_creation: unknown;
  signal_strength: number | null;
  conviction_level: string;
  uncertainty: unknown;
  entry_spread_pct: number | null;
  oi_at_entry: number | null;
  volume_at_entry: number | null;
  volume_to_oi_ratio: number | null;
  regime_at_creation: string | null;
  analyst_note: string | null;
  critic_note: string | null;
  primary_proposal: unknown;
  skeptic_critique: unknown;
  final_decision: unknown;
  status: string;
  invalidated_reason: string | null;
  closed_at: string | null;
  sector: string | null;
}

/** Row shape from `aiLabSeedData.json` deliberations array. */
interface AiLabSeedDeliberation {
  id: number;
  created_at: string;
  symbol: string;
  source: string;
  analyst_model_name: string | null;
  critic_model_name: string | null;
  input_snapshot: unknown;
  primary_proposal: unknown;
  skeptic_critique: unknown;
  final_decision: unknown;
  idea_id: number | null;
  conversation_log: unknown;
}

/** Shape of `aiLabSeedData.json` consumed by this migration. */
interface AiLabSeedDataFile {
  ideas: AiLabSeedIdea[];
  deliberations: AiLabSeedDeliberation[];
  embeddings?: AiLabSeedEmbeddingRow[];
}

const seedData = seedDataRaw as AiLabSeedDataFile;

export async function migrateAiLabSeedData(): Promise<void> {
  try {
    const [{ count: ideaCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiLabIdeasTable);

    if (ideaCount > 0) {
      logger.info({ ideaCount }, "AI Lab tables already populated — skipping seed migration");
      return;
    }

    logger.info(
      { ideas: seedData.ideas.length, deliberations: seedData.deliberations.length, embeddings: seedData.embeddings?.length ?? 0 },
      "AI Lab tables empty — seeding from migration data"
    );

    for (const idea of seedData.ideas) {
      await db.execute(sql`
        INSERT INTO ai_lab_ideas (
          id, created_at, origin_type, analyst_model_name, critic_model_name,
          symbol, direction, instrument_type, option_structure_type, legs,
          entry_zone, soft_stop, target_zone, time_horizon,
          thesis, catalyst, invalidation, regime_fit, main_signals,
          scanner_alignment_at_creation, signal_strength, conviction_level, uncertainty,
          entry_spread_pct, oi_at_entry, volume_at_entry, volume_to_oi_ratio,
          regime_at_creation, analyst_note, critic_note,
          primary_proposal, skeptic_critique, final_decision,
          status, invalidated_reason, closed_at, sector
        ) VALUES (
          ${idea.id}, ${idea.created_at}::timestamp, ${idea.origin_type}, ${idea.analyst_model_name}, ${idea.critic_model_name},
          ${idea.symbol}, ${idea.direction}, ${idea.instrument_type}, ${idea.option_structure_type ?? null}, ${idea.legs ? JSON.stringify(idea.legs) : null}::jsonb,
          ${idea.entry_zone ? JSON.stringify(idea.entry_zone) : null}::jsonb, ${idea.soft_stop ?? null}, ${idea.target_zone ? JSON.stringify(idea.target_zone) : null}::jsonb, ${idea.time_horizon},
          ${idea.thesis}, ${idea.catalyst}, ${idea.invalidation}, ${idea.regime_fit}, ${idea.main_signals ? JSON.stringify(idea.main_signals) : null}::jsonb,
          ${idea.scanner_alignment_at_creation ? JSON.stringify(idea.scanner_alignment_at_creation) : null}::jsonb, ${idea.signal_strength ?? null}, ${idea.conviction_level}, ${idea.uncertainty ? JSON.stringify(idea.uncertainty) : null}::jsonb,
          ${idea.entry_spread_pct ?? null}, ${idea.oi_at_entry ?? null}, ${idea.volume_at_entry ?? null}, ${idea.volume_to_oi_ratio ?? null},
          ${idea.regime_at_creation ?? null}, ${idea.analyst_note ?? null}, ${idea.critic_note ?? null},
          ${idea.primary_proposal ? JSON.stringify(idea.primary_proposal) : null}::jsonb, ${idea.skeptic_critique ? JSON.stringify(idea.skeptic_critique) : null}::jsonb, ${idea.final_decision ? JSON.stringify(idea.final_decision) : null}::jsonb,
          ${idea.status}, ${idea.invalidated_reason ?? null}, ${idea.closed_at ? sql`${idea.closed_at}::timestamp` : sql`NULL`}, ${idea.sector ?? null}
        ) ON CONFLICT DO NOTHING
      `);
    }

    await db.execute(sql`SELECT setval('ai_lab_ideas_id_seq', (SELECT COALESCE(MAX(id), 0) FROM ai_lab_ideas))`);

    for (const d of seedData.deliberations) {
      await db.execute(sql`
        INSERT INTO ai_lab_deliberations (
          id, created_at, symbol, source, analyst_model_name, critic_model_name,
          input_snapshot, primary_proposal, skeptic_critique, final_decision,
          idea_id, conversation_log
        ) VALUES (
          ${d.id}, ${d.created_at}::timestamp, ${d.symbol}, ${d.source}, ${d.analyst_model_name ?? null}, ${d.critic_model_name ?? null},
          ${d.input_snapshot ? JSON.stringify(d.input_snapshot) : null}::jsonb,
          ${d.primary_proposal ? JSON.stringify(d.primary_proposal) : null}::jsonb,
          ${d.skeptic_critique ? JSON.stringify(d.skeptic_critique) : null}::jsonb,
          ${d.final_decision ? JSON.stringify(d.final_decision) : null}::jsonb,
          ${d.idea_id ?? null},
          ${d.conversation_log ? JSON.stringify(d.conversation_log) : null}::jsonb
        ) ON CONFLICT DO NOTHING
      `);
    }

    await db.execute(sql`SELECT setval('ai_lab_deliberations_id_seq', (SELECT COALESCE(MAX(id), 0) FROM ai_lab_deliberations))`);

    const embeddings = seedData.embeddings;
    if (embeddings && Array.isArray(embeddings)) {
      for (const e of embeddings) {
        await db.execute(sql`
          INSERT INTO ai_lab_embeddings (
            id, idea_id, embedding, tags, created_at
          ) VALUES (
            ${e.id}, ${e.idea_id}, ${e.embedding ? JSON.stringify(e.embedding) : null}::jsonb,
            ${e.tags ? JSON.stringify(e.tags) : null}::jsonb, ${e.created_at}::timestamp
          ) ON CONFLICT DO NOTHING
        `);
      }
      await db.execute(sql`SELECT setval('ai_lab_embeddings_id_seq', (SELECT COALESCE(MAX(id), 0) FROM ai_lab_embeddings))`);
    }

    logger.info("AI Lab seed migration complete");
  } catch (err) {
    logger.error({ err }, "AI Lab seed migration failed — non-fatal, continuing boot");
  }
}
