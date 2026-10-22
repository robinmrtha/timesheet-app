-- Himalayan Bazaar timesheets
-- Neon / Postgres schema. Replaces Supabase Auth + public tables.
--
-- Apply with a DIRECT (non-pooled) connection on an empty database:
--   psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/schema.sql
--
-- pgcrypto remains from the old password login. Sign-in does not use it.
-- Cloudflare Access is the session (see DEPLOY-CLOUDFLARE.md).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ledger_summary (unused Amazon FBA ledger) is intentionally not created.
-- Multiple time_entries per user per work_date are allowed (split shifts).
-- profiles.hourly_rate was unused; rates live in employee_rates and are
-- copied onto each time_entries row. The column is kept so the migration
-- can carry the historical nulls.

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  name text,
  role text NOT NULL DEFAULT 'employee',
  hourly_rate numeric,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  CONSTRAINT users_role_check CHECK (role IN ('admin', 'employee')),
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_password_hash_present CHECK (length(password_hash) > 0)
);

COMMENT ON TABLE users IS 'Replaces Supabase auth.users and public.profiles. Same UUIDs. Sign-in is Cloudflare Access, matched on email.';
COMMENT ON COLUMN users.hourly_rate IS 'Copied from profiles. Unused for pay; see employee_rates.';
COMMENT ON COLUMN users.active IS 'Inactive users are not admitted. Admins still see their history.';
COMMENT ON COLUMN users.password_hash IS 'Retained from password login. Not read or checked. Do not drop.';

CREATE TABLE IF NOT EXISTS time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  work_date date NOT NULL,
  hours numeric NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'submitted',
  unpaid_reason text,
  approved_at timestamptz,
  approved_by uuid REFERENCES users (id),
  paid_at timestamptz,
  paid_by uuid REFERENCES users (id),
  paid_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  hourly_rate numeric,
  CONSTRAINT time_entries_status_check CHECK (status IN ('submitted', 'approved', 'paid'))
);

COMMENT ON TABLE time_entries IS 'No unique (user_id, work_date): employees log split shifts as separate rows.';
COMMENT ON COLUMN time_entries.hourly_rate IS 'Snapshot of employee_rates for work_date at the time the row was saved.';
COMMENT ON COLUMN time_entries.approved_at IS 'Unused. Entries are submitted, then marked paid. Kept for compatibility.';
COMMENT ON COLUMN time_entries.approved_by IS 'Unused. Kept for compatibility. Nullable.';
COMMENT ON COLUMN time_entries.paid_by IS 'Admin who marked the row paid. Nullable on historical rows.';

CREATE TABLE IF NOT EXISTS employee_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  hourly_rate numeric NOT NULL,
  effective_from date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users (id)
);

COMMENT ON COLUMN employee_rates.created_by IS 'Admin who added the rate. Nullable on historical rows.';

CREATE TABLE IF NOT EXISTS login_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS time_entries_user_work_date_idx
  ON time_entries (user_id, work_date DESC);

CREATE INDEX IF NOT EXISTS time_entries_status_idx
  ON time_entries (status);

CREATE INDEX IF NOT EXISTS employee_rates_lookup_idx
  ON employee_rates (user_id, effective_from DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS login_attempts_ip_created_idx
  ON login_attempts (ip, created_at DESC);
