ALTER TABLE "catalyst_earnings_dates"
  ADD COLUMN IF NOT EXISTS "last_earnings_date" date;
