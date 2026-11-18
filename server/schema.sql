CREATE TABLE IF NOT EXISTS meetings (
  org text NOT NULL, id text NOT NULL, revision integer NOT NULL DEFAULT 0,
  document jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, PRIMARY KEY (org, id)
);
CREATE TABLE IF NOT EXISTS jobs (
  org text NOT NULL, meeting_id text NOT NULL, lease text, lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org, meeting_id), FOREIGN KEY (org, meeting_id) REFERENCES meetings(org,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS meeting_events (
  seq bigserial PRIMARY KEY, org text NOT NULL, meeting_id text NOT NULL, revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org, meeting_id) REFERENCES meetings(org,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS meeting_events_lookup ON meeting_events(org, meeting_id, seq);
CREATE TABLE IF NOT EXISTS command_receipts (
  org text NOT NULL, meeting_id text NOT NULL, key text NOT NULL, digest text NOT NULL,
  PRIMARY KEY(org,meeting_id,key), FOREIGN KEY(org,meeting_id) REFERENCES meetings(org,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS object_cleanup (key text PRIMARY KEY, available_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ai_usage (
  org text NOT NULL, day date NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY(org,day)
);
