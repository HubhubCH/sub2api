ALTER TABLE generation_records
    ADD COLUMN IF NOT EXISTS creator_tool VARCHAR(32) NOT NULL DEFAULT '';
