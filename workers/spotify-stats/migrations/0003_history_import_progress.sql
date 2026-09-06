PRAGMA defer_foreign_keys = ON;

DROP INDEX IF EXISTS idx_history_imports_status_created_at;

ALTER TABLE history_imports RENAME TO history_imports_legacy;

CREATE TABLE history_imports (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	source TEXT NOT NULL CHECK (length(trim(source)) > 0),
	source_checksum TEXT NOT NULL CHECK (length(trim(source_checksum)) > 0),
	plan_fingerprint TEXT NOT NULL CHECK (length(plan_fingerprint) = 64),
	cutoff_at TEXT NOT NULL,
	chunk_size INTEGER NOT NULL CHECK (chunk_size > 0),
	total_chunks INTEGER NOT NULL CHECK (total_chunks >= 0),
	status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
	total_records INTEGER NOT NULL DEFAULT 0 CHECK (total_records >= 0),
	imported_records INTEGER NOT NULL DEFAULT 0 CHECK (imported_records >= 0),
	skipped_records INTEGER NOT NULL DEFAULT 0 CHECK (skipped_records >= 0),
	earliest_ended_at TEXT,
	latest_ended_at TEXT,
	started_at TEXT,
	completed_at TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE (plan_fingerprint),
	CHECK (imported_records + skipped_records <= total_records),
	CHECK ((earliest_ended_at IS NULL) = (latest_ended_at IS NULL)),
	CHECK (earliest_ended_at IS NULL OR earliest_ended_at <= latest_ended_at),
	CHECK (completed_at IS NULL OR started_at IS NOT NULL)
);

INSERT INTO history_imports (
	id, source, source_checksum, plan_fingerprint, cutoff_at, chunk_size, total_chunks,
	status, total_records, imported_records, skipped_records, earliest_ended_at,
	latest_ended_at, started_at, completed_at, created_at, updated_at
)
SELECT
	id, source, source_checksum, 'legacy-' || printf('%057d', id),
	COALESCE(latest_ended_at, completed_at, started_at, created_at), 1, 0,
	status, total_records, imported_records, skipped_records, earliest_ended_at,
	latest_ended_at, started_at, completed_at, created_at, updated_at
FROM history_imports_legacy;

DROP TABLE history_imports_legacy;

CREATE INDEX idx_history_imports_status_created_at
	ON history_imports (status, created_at);

CREATE TABLE history_import_chunks (
	plan_fingerprint TEXT NOT NULL REFERENCES history_imports (plan_fingerprint) ON DELETE CASCADE,
	chunk_number INTEGER NOT NULL CHECK (chunk_number > 0),
	chunk_checksum TEXT NOT NULL CHECK (length(chunk_checksum) = 64),
	expected_records INTEGER NOT NULL CHECK (expected_records >= 0),
	reported_rows_written INTEGER CHECK (reported_rows_written >= 0),
	final_bookmark TEXT,
	applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (plan_fingerprint, chunk_number),
	UNIQUE (plan_fingerprint, chunk_checksum)
);
