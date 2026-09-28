import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function parseWranglerJson(output: string): unknown[] {
	const start = output.indexOf("[");
	if (start < 0) throw new Error(`Wrangler did not return JSON: ${output}`);
	return JSON.parse(output.slice(start));
}

describe("historical metadata fallback migration", () => {
	it("reports fallback artists, merges unambiguous exact-name matches, and ignores fallback on enriched tracks", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "spotify-history-metadata-d1-"));
		temporaryDirectories.push(root);
		const statePath = resolve(root, "state");
		const configPath = resolve(root, "wrangler.toml");
		const workerEntry = resolve(process.cwd(), "workers/spotify-stats/src/index.ts").replaceAll("\\", "/");
		const migrationsPath = resolve(process.cwd(), "workers/spotify-stats/migrations");
		await writeFile(configPath, `name = "spotify-history-metadata-d1-test"
main = "${workerEntry}"
compatibility_date = "2026-08-27"

[[d1_databases]]
binding = "DB"
database_name = "spotify-history-metadata-d1-test"
database_id = "00000000-0000-0000-0000-000000000001"
`, "utf8");

		const wranglerPath = resolve(process.cwd(), "node_modules/wrangler/bin/wrangler.js");
		const common = ["--local", "--config", configPath, "--persist-to", statePath];
		for (const migration of ["0001_initial.sql", "0002_history_import.sql", "0003_history_import_progress.sql", "0004_history_metadata_fallback.sql"]) {
			await execFileAsync(process.execPath, [
				wranglerPath, "d1", "execute", "DB", ...common,
				"--file", resolve(migrationsPath, migration),
			]);
		}

		await execFileAsync(process.execPath, [
			wranglerPath, "d1", "execute", "DB", ...common,
			"--command", `
INSERT INTO artists (spotify_artist_id, name, spotify_url) VALUES
	('artist-known', 'Known Artist', 'https://open.spotify.com/artist/artist-known'),
	('artist-live', 'Live Artist', 'https://open.spotify.com/artist/artist-live'),
	('artist-shared-a', 'Shared Name', NULL),
	('artist-shared-b', 'Shared Name', NULL);
INSERT INTO albums (spotify_album_id, name) VALUES ('album-live', 'Live Album');
INSERT INTO tracks (
	spotify_track_id, spotify_album_id, name, duration_ms, history_artist_name, history_album_name
) VALUES
	('fallback-only', NULL, 'Fallback Track', 0, 'Export Artist', 'Export Album'),
	('fallback-match', NULL, 'Matching Track', 0, ' known artist ', 'Historical Known Album'),
	('fallback-ambiguous', NULL, 'Ambiguous Track', 0, 'Shared Name', 'Ambiguous Album'),
	('enriched', 'album-live', 'Enriched Track', 180000, 'Wrong Fallback Artist', 'Wrong Fallback Album');
INSERT INTO track_artists (spotify_track_id, spotify_artist_id, artist_order)
VALUES ('enriched', 'artist-live', 0);
INSERT INTO plays (spotify_track_id, played_at, played_at_unix_ms) VALUES
	('fallback-only', '2020-01-01T00:00:00.000Z', 1577836800000),
	('fallback-match', '2020-01-02T00:00:00.000Z', 1577923200000),
	('fallback-ambiguous', '2020-01-02T12:00:00.000Z', 1577966400000),
	('enriched', '2020-01-03T00:00:00.000Z', 1578009600000);`,
		]);

		const { stdout } = await execFileAsync(process.execPath, [
			wranglerPath, "d1", "execute", "DB", ...common,
			"--command", `SELECT
	artist.spotify_track_id,
	artist.artist_id,
	artist.name,
	artist.spotify_url,
	COALESCE(album.spotify_album_id, '') AS album_id,
	COALESCE(album.name, track.history_album_name, '') AS album_name
FROM reporting_track_artists artist
JOIN tracks track ON track.spotify_track_id = artist.spotify_track_id
LEFT JOIN albums album ON album.spotify_album_id = track.spotify_album_id
ORDER BY artist.spotify_track_id;`,
			"--json",
		]);
		const response = parseWranglerJson(stdout) as Array<{ results: Array<Record<string, unknown>> }>;

		expect(response[0].results).toEqual([
			{
				spotify_track_id: "enriched",
				artist_id: "artist-live",
				name: "Live Artist",
				spotify_url: "https://open.spotify.com/artist/artist-live",
				album_id: "album-live",
				album_name: "Live Album",
			},
			{
				spotify_track_id: "fallback-ambiguous",
				artist_id: "history:shared name",
				name: "Shared Name",
				spotify_url: null,
				album_id: "",
				album_name: "Ambiguous Album",
			},
			{
				spotify_track_id: "fallback-match",
				artist_id: "artist-known",
				name: "Known Artist",
				spotify_url: "https://open.spotify.com/artist/artist-known",
				album_id: "",
				album_name: "Historical Known Album",
			},
			{
				spotify_track_id: "fallback-only",
				artist_id: "history:export artist",
				name: "Export Artist",
				spotify_url: null,
				album_id: "",
				album_name: "Export Album",
			},
		]);
	}, 20_000);
});
