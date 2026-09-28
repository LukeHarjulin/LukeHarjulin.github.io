import { describe, expect, it, vi } from "vitest";
import {
	enrichTrackMetadata,
	fetchSpotifyTrackWithRetry,
	generateHistoryImportSql,
	isStreamingHistoryPayload,
	parseHistoryRecords,
} from "../src/history-import";
import type { SpotifyTrack } from "../src/types";

const TRACK_ID = "11dFghVXANMlKmJXsNCbNl";
const TRACK_URI = `spotify:track:${TRACK_ID}`;

function historyRecord(overrides: Record<string, unknown> = {}) {
	return {
		ts: "2025-01-02T12:00:00Z",
		ms_played: 120000,
		spotify_track_uri: TRACK_URI,
		master_metadata_track_name: "History Track",
		master_metadata_album_artist_name: "History Artist",
		master_metadata_album_album_name: "History Album",
		incognito_mode: false,
		ip_addr_decrypted: "192.0.2.1",
		...overrides,
	};
}

function spotifyTrack(): SpotifyTrack {
	return {
		id: TRACK_ID,
		name: "History Track",
		duration_ms: 180000,
		explicit: false,
		external_urls: { spotify: `https://open.spotify.com/track/${TRACK_ID}` },
		artists: [{
			id: "artist-id",
			name: "History Artist",
			external_urls: { spotify: "https://open.spotify.com/artist/artist-id" },
		}],
		album: {
			id: "album-id",
			name: "History Album",
			album_type: "album",
			release_date: "2024-01-01",
			images: [{ url: "https://images.example/history.jpg" }],
			external_urls: { spotify: "https://open.spotify.com/album/album-id" },
		},
	};
}

describe("extended history parsing", () => {
	it("detects history arrays by structure rather than filename", () => {
		expect(isStreamingHistoryPayload([historyRecord()])).toBe(true);
		expect(isStreamingHistoryPayload({ items: [] })).toBe(false);
	});

	it("filters private, unsupported, invalid, zero-duration, cutoff, and duplicate records", async () => {
		const parsed = await parseHistoryRecords([
			historyRecord(),
			historyRecord(),
			historyRecord({ incognito_mode: true, ts: "2024-01-01T00:00:00Z" }),
			historyRecord({ spotify_episode_uri: "spotify:episode:abc", ts: "2024-01-02T00:00:00Z" }),
			historyRecord({ spotify_track_uri: null, ts: "2024-01-03T00:00:00Z" }),
			historyRecord({ spotify_track_uri: "spotify:track:bad", ts: "2024-01-04T00:00:00Z" }),
			historyRecord({ ms_played: 0, ts: "2024-01-05T00:00:00Z" }),
			historyRecord({ ts: "not-a-date" }),
			historyRecord({ ts: "2026-01-01T00:00:00Z" }),
		], "2026-01-01T00:00:00Z");

		expect(parsed.plays).toHaveLength(1);
		expect(parsed.plays[0]).toMatchObject({
			trackId: TRACK_ID,
			endedAt: "2025-01-02T12:00:00.000Z",
			listenedMs: 120000,
		});
			expect(parsed.excluded).toMatchObject({
			duplicate: 1,
			private_session: 1,
			unsupported_media: 1,
			missing_track_uri: 1,
			invalid_track_uri: 1,
			non_positive_duration: 1,
			invalid_timestamp: 1,
			outside_live_cutoff: 1,
		});
		expect(JSON.stringify(parsed)).not.toContain("192.0.2.1");
	});

	it("keeps the greatest duration when export rows share a track and timestamp", async () => {
		const parsed = await parseHistoryRecords([
			historyRecord({ ms_played: 1000 }),
			historyRecord({ ms_played: 5000 }),
			historyRecord({ ms_played: 3000 }),
		], "2026-01-01T00:00:00Z");

		expect(parsed.plays).toHaveLength(1);
		expect(parsed.plays[0].listenedMs).toBe(5000);
		expect(parsed.excluded.duplicate_track_timestamp).toBe(2);
	});

	it("accepts legacy camel-case field names", async () => {
		const parsed = await parseHistoryRecords([{
			endTime: "2024-02-03T04:05:06Z",
			msPlayed: 1000,
			spotifyTrackUri: TRACK_URI,
			incognitoMode: false,
		}], "2025-01-01T00:00:00Z");
		expect(parsed.plays).toHaveLength(1);
	});
});

describe("metadata enrichment", () => {
	it("uses a bounded cache and reports unavailable tracks", async () => {
		const loader = vi.fn(async (id: string) => id === TRACK_ID ? spotifyTrack() : null);
		const result = await enrichTrackMetadata([TRACK_ID, TRACK_ID, "missing"], loader, new Map(), 2);
		expect(loader).toHaveBeenCalledTimes(2);
		expect(result.tracks.get(TRACK_ID)?.name).toBe("History Track");
		expect(result.unavailableTrackIds).toEqual(["missing"]);
	});

	it("honors Retry-After for rate-limited metadata requests", async () => {
		const fetcher = vi.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "2" } }))
			.mockResolvedValueOnce(Response.json(spotifyTrack()));
		const sleep = vi.fn(async () => undefined);
		await expect(fetchSpotifyTrackWithRetry(TRACK_ID, "token", { fetcher, sleep })).resolves.toMatchObject({ id: TRACK_ID });
		expect(sleep).toHaveBeenCalledWith(2000);
	});
});

describe("SQL generation", () => {
	it("generates deterministic idempotent play and audit SQL with actual duration", async () => {
		const parsed = await parseHistoryRecords([historyRecord()], "2026-01-01T00:00:00Z");
		const metadata = new Map([[TRACK_ID, spotifyTrack()]]);
		const checksum = "a".repeat(64);
		const options = {
			sourceChecksum: checksum,
			planFingerprint: "c".repeat(64),
			cutoff: "2026-01-01T00:00:00Z",
			chunkSize: 1,
		};
		const first = await generateHistoryImportSql(parsed, metadata, options);
		const second = await generateHistoryImportSql(parsed, metadata, options);

		expect(first).toEqual(second);
		expect(first.chunkSql).toHaveLength(1);
		expect(first.initializeSql).toContain("spotify_extended_history");
		expect(first.initializeSql).toContain(options.planFingerprint);
		expect(first.chunkSql[0]).toContain("INSERT INTO plays");
		expect(first.chunkSql[0]).toContain("WHERE plays.source = 'spotify_export'");
		expect(first.chunkSql[0]).toContain("'spotify_export'");
		expect(first.chunkSql[0]).toContain("120000");
		expect(first.chunkSql[0]).toContain("INSERT INTO history_import_chunks");
		expect(first.chunkSql[0]).toContain("ON CONFLICT (spotify_album_id) DO NOTHING");
		expect(first.chunkSql[0]).toContain("ON CONFLICT (spotify_artist_id) DO NOTHING");
		expect(first.chunkSql[0]).toContain("WHERE NOT EXISTS");
		expect(first.chunkSql[0]).not.toContain("DELETE FROM track_artists");
		expect(first.chunkSql[0]).toContain(first.chunkChecksums[0]);
		expect(first.chunkExpectedRecords).toEqual([1]);
		expect(first.chunkEstimatedRowsWritten[0]).toBeGreaterThan(5);
		expect(first.chunkSql[0]).not.toMatch(/\b(?:BEGIN|COMMIT)\b/);
		expect(first.auditSql).toContain("SELECT COUNT(*)");
		expect(first.importedRecords).toBe(1);
	});

	it("escapes apostrophes in Spotify metadata", async () => {
		const parsed = await parseHistoryRecords([historyRecord()], "2026-01-01T00:00:00Z");
		const track = spotifyTrack();
		track.name = "Listener's Track";
		const plan = await generateHistoryImportSql(parsed, new Map([[TRACK_ID, track]]), {
			sourceChecksum: "b".repeat(64),
			planFingerprint: "d".repeat(64),
			cutoff: "2026-01-01T00:00:00Z",
		});
		expect(plan.chunkSql[0]).toContain("Listener''s Track");
	});

	it("imports export metadata without inventing Spotify artist or album IDs", async () => {
		const parsed = await parseHistoryRecords([historyRecord({
			master_metadata_track_name: "Export-only Track",
			master_metadata_album_artist_name: "Export-only Artist",
			master_metadata_album_album_name: "Export-only Album",
		})], "2026-01-01T00:00:00Z");
		const plan = await generateHistoryImportSql(parsed, new Map(), {
			sourceChecksum: "e".repeat(64),
			planFingerprint: "f".repeat(64),
			cutoff: "2026-01-01T00:00:00Z",
		});

		expect(plan.importedRecords).toBe(1);
		expect(plan.chunkSql[0]).toContain("history_artist_name, history_album_name");
		expect(plan.chunkSql[0]).toContain("'Export-only Track'");
		expect(plan.chunkSql[0]).toContain("'Export-only Artist'");
		expect(plan.chunkSql[0]).toContain("'Export-only Album'");
		expect(plan.chunkSql[0]).not.toContain("INSERT INTO artists");
		expect(plan.chunkSql[0]).not.toContain("INSERT INTO albums");
	});
});
