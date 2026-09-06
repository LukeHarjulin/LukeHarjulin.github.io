import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const trackId = "0123456789ABCDEFGHIJKL";
const unavailableTrackId = "UNAVAILABLETRACK000001";

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Spotify history import CLI", () => {
	it("creates a private deterministic plan from a cached synthetic export", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "spotify-history-cli-"));
		temporaryDirectories.push(root);
		const inputPath = resolve(root, "Streaming_History_Audio.json");
		const workspace = resolve(root, "private-workspace");
		const cacheDirectory = resolve(workspace, "cache");
		const devVarsPath = resolve(root, ".dev.vars");
		const resultPath = resolve(root, "result.json");
		await mkdir(cacheDirectory, { recursive: true });
		await writeFile(devVarsPath, "", "utf8");
		await writeFile(inputPath, JSON.stringify([
			{
				ts: "2025-01-01T12:00:00Z",
				ms_played: 12345,
				spotify_track_uri: `spotify:track:${trackId}`,
				master_metadata_track_name: "Example",
			},
			{
				ts: "2025-01-01T12:00:00Z",
				ms_played: 12345,
				spotify_track_uri: `spotify:track:${trackId}`,
			},
			{
				ts: "2026-01-01T12:00:00Z",
				ms_played: 5000,
				spotify_track_uri: `spotify:track:${trackId}`,
			},
			{
				ts: "2025-02-01T12:00:00Z",
				ms_played: 5000,
				spotify_track_uri: `spotify:track:${trackId}`,
				incognito_mode: true,
			},
			{
				ts: "2025-03-01T12:00:00Z",
				ms_played: 5000,
				spotify_episode_uri: "spotify:episode:0123456789ABCDEFGHIJKL",
			},
			{
				ts: "2025-04-01T12:00:00Z",
				ms_played: 5000,
				spotify_track_uri: `spotify:track:${unavailableTrackId}`,
				master_metadata_track_name: "Unavailable Example",
				master_metadata_album_artist_name: "Unavailable Artist",
				master_metadata_album_album_name: "Unavailable Album",
			},
		]), "utf8");
		await writeFile(resolve(cacheDirectory, "tracks.json"), JSON.stringify({
			version: 1,
			tracks: {
				[trackId]: {
					id: trackId,
					name: "Example",
					duration_ms: 200000,
					explicit: false,
					artists: [{ id: "artist-1", name: "Artist" }],
					album: { id: "album-1", name: "Album", images: [] },
				},
				[unavailableTrackId]: null,
			},
		}), "utf8");

		const cliPath = resolve(process.cwd(), "tools", "spotify_history_import.mjs");
		const args = [
			cliPath,
			"--input", inputPath,
			"--cutoff", "2026-01-01T00:00:00Z",
			"--workspace", workspace,
			"--dev-vars", devVarsPath,
			"--result-file", resultPath,
			"--chunk-size", "1",
		];
		await execFileAsync(process.execPath, args);
		const result = JSON.parse(await readFile(resultPath, "utf8"));
		const initializeSql = await readFile(result.initializeFile, "utf8");
		const sql = await readFile(result.chunkFiles[0], "utf8");
		const fallbackSql = await readFile(result.chunkFiles[1], "utf8");

		expect(result.report).toMatchObject({
			totalRecords: 6,
			candidateMusicRecords: 2,
			importableRecords: 2,
			skippedRecords: 4,
			chunkCount: 2,
			metadataMode: "cache-only",
			catalogTrackCount: 1,
			fallbackTrackCount: 1,
			unresolvedTrackCount: 0,
			unresolvedPlayRecords: 0,
			catalogMetadataMissingTrackCount: 1,
			exclusions: {
				duplicate: 1,
				outside_live_cutoff: 1,
				private_session: 1,
				unsupported_media: 1,
			},
		});
		expect(sql).toContain("'spotify_export'");
		expect(sql).toContain("12345");
		expect(initializeSql).toContain(result.report.planFingerprint);
		expect(result.chunks[0]).toMatchObject({
			chunkNumber: 1,
			expectedRecords: 1,
		});
		expect(sql).toContain(result.chunks[0].checksum);
		expect(sql).not.toContain("200000, '2025-01-01T12:00:00.000Z'");
		expect(fallbackSql).toContain("'Unavailable Example'");
		expect(fallbackSql).toContain("'Unavailable Artist'");
		expect(fallbackSql).toContain("'Unavailable Album'");
		expect(fallbackSql).not.toContain("INSERT INTO artists");

		const firstSql = sql;
		const firstFingerprint = result.report.planFingerprint;
		await execFileAsync(process.execPath, args);
		expect(await readFile(result.chunkFiles[0], "utf8")).toBe(firstSql);

		const changedCache = JSON.parse(await readFile(resolve(cacheDirectory, "tracks.json"), "utf8"));
		changedCache.tracks[trackId].name = "Renamed Example";
		await writeFile(resolve(cacheDirectory, "tracks.json"), JSON.stringify(changedCache), "utf8");
		await execFileAsync(process.execPath, args);
		const changedResult = JSON.parse(await readFile(resultPath, "utf8"));
		expect(changedResult.report.planFingerprint).not.toBe(firstFingerprint);
		expect(changedResult.planDirectory).not.toBe(result.planDirectory);
	});
});
