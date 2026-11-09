-- A recipe's ingredient lines and method steps in Hindi, Bengali and Gujarati (made by the AI, checked for numbers), and the tries that failed.
CREATE TABLE IF NOT EXISTS kp_recipe_i18n (
  recipe_id        INTEGER NOT NULL,
  lang             TEXT    NOT NULL,
  ingredients_json TEXT    NOT NULL,
  steps_json       TEXT    NOT NULL,
  model            TEXT,
  src_hash         TEXT    NOT NULL,     -- fingerprint of the English lists it came from: it is used only while they are unchanged
  translated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (recipe_id, lang)
);
CREATE INDEX IF NOT EXISTS idx_kp_recipe_i18n_at ON kp_recipe_i18n(translated_at);
CREATE TABLE IF NOT EXISTS kp_i18n_tries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL,
  lang      TEXT    NOT NULL,
  why       TEXT,
  tried_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kp_i18n_tries ON kp_i18n_tries(recipe_id, lang, tried_at);
