CREATE TABLE IF NOT EXISTS store_customer_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS store_customer_accounts_email_lower_idx
  ON store_customer_accounts (lower(email));
