-- Which custom events mean a visitor activated, started paying, paid, failed to pay or gave up,
-- as corrected in site settings: {"activation": [...], "start": [...], "paid": [...],
-- "failed": [...], "closed": [...]}. Null means they are guessed from the event names.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS key_events jsonb;
