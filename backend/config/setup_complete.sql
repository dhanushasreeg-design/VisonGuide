-- VisionGuide AI — Complete Database Setup
-- Paste this entire script into Supabase > SQL Editor > Run
-- This is the single source of truth. Run once on a fresh project.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. USERS (custom auth table — not Supabase auth.users)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS users_email_idx ON public.users (email);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Allow anon key full access (security enforced by Express JWT, not Supabase RLS)
CREATE POLICY "backend_full_access" ON public.users
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. EMERGENCY CONTACTS
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES public.users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  phone      TEXT        NOT NULL,
  relation   TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user_id ON emergency_contacts(user_id);

ALTER TABLE emergency_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON emergency_contacts FOR ALL TO anon USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. ARTICLES
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS articles (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES public.users(id) ON DELETE CASCADE,
  title      TEXT        NOT NULL,
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_articles_user_id ON articles(user_id);

ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON articles FOR ALL TO anon USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. VOICE COMMANDS LOG
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commands (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES public.users(id) ON DELETE CASCADE,
  command_text  TEXT        NOT NULL,
  response_text TEXT,
  command_type  TEXT        DEFAULT 'unknown',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commands_user_id ON commands(user_id);

ALTER TABLE commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON commands FOR ALL TO anon USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. NAVIGATION REQUESTS
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS navigation_requests (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES public.users(id) ON DELETE CASCADE,
  destination TEXT        NOT NULL,
  status      TEXT        DEFAULT 'requested',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_navigation_requests_user_id ON navigation_requests(user_id);

ALTER TABLE navigation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON navigation_requests FOR ALL TO anon USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. SOS ALERTS
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sos_alerts (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES public.users(id) ON DELETE CASCADE,
  message    TEXT        NOT NULL,
  location   TEXT,
  status     TEXT        DEFAULT 'sent',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sos_alerts_user_id ON sos_alerts(user_id);

ALTER TABLE sos_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON sos_alerts FOR ALL TO anon USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 7. SAVED LOCATIONS
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_locations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES public.users(id) ON DELETE CASCADE,
  place_name TEXT        NOT NULL,
  address    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_locations_user_id ON saved_locations(user_id);

ALTER TABLE saved_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON saved_locations FOR ALL TO anon USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 8. USER FEEDBACK
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_feedback (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES public.users(id) ON DELETE CASCADE,
  name       TEXT,
  feedback   TEXT        NOT NULL,
  rating     INTEGER     CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id ON user_feedback(user_id);

ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON user_feedback FOR ALL TO anon USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────────
-- Done. All 8 tables created with RLS + indexes.
-- ────────────────────────────────────────────────────────────────────────────
