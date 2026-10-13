-- Currency revenue is reported in: the payment provider's settlement currency.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
