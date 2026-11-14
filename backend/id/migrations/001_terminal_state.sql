-- Small internal-beta state model. A single row lock serializes short mutations,
-- including challenge consumption and order claims, across server instances.
CREATE TABLE IF NOT EXISTS terminal_state (
  id integer PRIMARY KEY CHECK (id = 1),
  origin text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
