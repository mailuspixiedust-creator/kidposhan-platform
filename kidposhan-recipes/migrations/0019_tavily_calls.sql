-- Counts the Tavily searches the recipe code makes each day, so a daily cap can protect the free quota.
CREATE TABLE IF NOT EXISTS kp_tavily_calls (
  day    TEXT PRIMARY KEY,      -- UTC date, YYYY-MM-DD
  calls  INTEGER NOT NULL DEFAULT 0
);
