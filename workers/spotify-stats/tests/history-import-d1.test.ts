import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { generateHistoryImportSql, parseHistoryRecords } from "../src/history-import";
import type { SpotifyTrack } from "../src/types";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const trackId = "11dFghVXANMlKmJXsNCbNl";

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function parseWranglerJson(output: string): unknown[] {
	const start = output.indexOf("[");
	if (start < 0) throw new Error(`Wrangler did not return JSON: ${output}`);
	return JSON.parse(output.slice(start));
}

describe("historical import D1 artifacts", () => {
	it("migrates, records progress, finalizes, and remains idempotent", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "spotify-history-d1-"));
		temporaryDirectories.push(root);
		const statePath = resolve(root, "state");
		const configPath = resolve(root, "wrangler.toml");
		const initializePath = resolve(root, "initialize.sql");
		const chunkPath = resolve(root, "chunk.sql");
		const auditPath = resolve(root, "audit.sql");
		const workerEntry = resolve(process.cwd(), "workers/spotify-stats/src/index.ts").replaceAll("\\", "/");
		const migrationsPath = resolve(process.cwd(), "workers/spotify-stats/migrations");
		const migrations = migrationsPath.replaceAll("\\", "/");
		await writeFile(configPath, `name = "spotify-history-d1-test"
main = "${workerEntry}"
compatibility_date = "2026-08-27"

[[d1_databases]]
binding = "DB"
database_name = "spotify-history-d1-test"
database_id = "00000000-0000-0000-0000-000000000001"
migrations_dir = "${migrations}"
`, "utf8");

		const track: SpotifyTrack = {
			id: trackId,
			name: "D1 History Track",
			duration_ms: 180000,
			explicit: false,
			artists: [{ id: "d1-artist", name: "D1 Artist" }],
			album: { id: "d1-album", name: "D1 Album", images: [] },
		};
		const parsed = await parseHistoryRecords([{
			ts: "2020-01-02T03:04:05Z",
			ms_played: 43210,
			spotify_track_uri: `spotify:track:${trackId}`,
		}], "2025-01-01T00:00:00Z");
		const planFingerprint = "c".repeat(64);
		const plan = await generateHistoryImportSql(parsed, new Map([[trackId, track]]), {
			sourceChecksum: "a".repeat(64),
			planFingerprint,
			cutoff: "2025-01-01T00:00:00Z",
			chunkSize: 1,
		});
		await writeFile(initializePath, plan.initializeSql, "utf8");
		await writeFile(chunkPath, plan.chunkSql[0], "utf8");
		await writeFile(auditPath, plan.auditSql, "utf8");

		const wranglerPath = resolve(process.cwd(), "node_modules/wrangler/bin/wrangler.js");
		const common = ["--local", "--config", configPath, "--persist-to", statePath];
		for (const migration of ["0001_initial.sql", "0002_history_import.sql"]) {
			await execFileAsync(process.execPath, [
				wranglerPath, "d1", "execute", "DB", ...common,
				"--file", resolve(migrationsPath, migration),
			]);
		}
		await execFileAsync(process.execPath, [
			wranglerPath, "d1", "execute", "DB", ...common,
			"--command", `INSERT INTO history_imports (
	source, source_checksum, status, total_records, imported_records, skipped_records, started_at, completed_at
) VALUES
	('legacy-a', 'short-checksum', 'completed', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('legacy-b', 'short-checksum', 'completed', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
		]);
		await execFileAsync(process.execPath, [
			wranglerPath, "d1", "execute", "DB", ...common,
			"--file", resolve(migrationsPath, "0003_history_import_progress.sql"),
		]);
		await execFileAsync(process.execPath, [
			wranglerPath, "d1", "execute", "DB", ...common,
			"--file", resolve(migrationsPath, "0004_history_metadata_fallback.sql"),
		]);
		await execFileAsync(process.execPath, [
			wranglerPath, "d1", "execute", "DB", ...common,
			"--command", `INSERT INTO albums (spotify_album_id, name) VALUES ('d1-album', 'Fresh D1 Album');
INSERT INTO artists (spotify_artist_id, name) VALUES ('d1-artist', 'Fresh D1 Artist');
INSERT INTO tracks (spotify_track_id, spotify_album_id, name, duration_ms, explicit)
VALUES ('${trackId}', 'd1-album', 'Fresh D1 Track', 181000, 1);
INSERT INTO track_artists (spotify_track_id, spotify_artist_id, artist_order)
VALUES ('${trackId}', 'd1-artist', 0);`,
		]);
		await execFileAsync(process.execPath, [wranglerPath, "d1", "execute", "DB", ...common, "--file", initializePath]);
		await execFileAsync(process.execPath, [wranglerPath, "d1", "execute", "DB", ...common, "--file", chunkPath]);
		await execFileAsync(process.execPath, [wranglerPath, "d1", "execute", "DB", ...common, "--file", chunkPath]);
		await execFileAsync(process.execPath, [wranglerPath, "d1", "execute", "DB", ...common, "--file", auditPath]);
		const { stdout } = await execFileAsync(process.execPath, [
			wranglerPath,
			"d1", "execute", "DB",
			...common,
			"--command", `SELECT
	(SELECT COUNT(*) FROM plays WHERE source = 'spotify_export') AS play_count,
	(SELECT SUM(listened_ms) FROM plays WHERE source = 'spotify_export') AS listened_ms,
	(SELECT COUNT(*) FROM history_import_chunks WHERE plan_fingerprint = '${planFingerprint}') AS chunk_count,
	(SELECT status FROM history_imports WHERE plan_fingerprint = '${planFingerprint}') AS import_status,
	(SELECT COUNT(*) FROM history_imports WHERE source LIKE 'legacy-%') AS legacy_count,
	(SELECT COUNT(DISTINCT plan_fingerprint) FROM history_imports WHERE source LIKE 'legacy-%') AS legacy_fingerprints,
	(SELECT name FROM tracks WHERE spotify_track_id = '${trackId}') AS track_name,
	(SELECT duration_ms FROM tracks WHERE spotify_track_id = '${trackId}') AS track_duration_ms,
	(SELECT name FROM albums WHERE spotify_album_id = 'd1-album') AS album_name,
	(SELECT name FROM artists WHERE spotify_artist_id = 'd1-artist') AS artist_name,
	(SELECT COUNT(*) FROM track_artists WHERE spotify_track_id = '${trackId}') AS artist_relation_count;`,
			"--json",
		]);
		const response = parseWranglerJson(stdout) as Array<{ results: Array<Record<string, unknown>> }>;

		expect(response[0].results[0]).toEqual({
			play_count: 1,
			listened_ms: 43210,
			chunk_count: 1,
			import_status: "completed",
			legacy_count: 2,
			legacy_fingerprints: 2,
			track_name: "Fresh D1 Track",
			track_duration_ms: 181000,
			album_name: "Fresh D1 Album",
			artist_name: "Fresh D1 Artist",
			artist_relation_count: 1,
		});
	}, 20_000);
});
