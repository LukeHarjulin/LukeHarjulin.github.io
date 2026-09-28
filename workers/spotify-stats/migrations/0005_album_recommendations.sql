CREATE TABLE album_recommendation_days (
	date TEXT PRIMARY KEY,
	generated_at TEXT,
	retry_after_ms INTEGER NOT NULL DEFAULT 0,
	lease_owner TEXT,
	payload TEXT
);
