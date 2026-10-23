-- Optional semester / academic-year label on a subject (e.g. "Sem 5", "2026-27").
-- IF NOT EXISTS keeps this safe on a database where `prisma db push` already added the column.
ALTER TABLE "Subject" ADD COLUMN IF NOT EXISTS "span" TEXT;
