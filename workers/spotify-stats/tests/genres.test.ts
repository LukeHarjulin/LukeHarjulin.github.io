import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reserveCatalogueRequest, pauseCatalogue } from "../src/catalogue-budget";
import { enrichArtistGenres, normalizeGenres } from "../src/genre-enrichment";
import { genreBreakdown } from "../src/trend-taste";
import { getTrends } from "../src/trends";
import { RecommendationCatalogue } from "../src/recommendation-catalogue";
import worker from "../src/index";
import { getImportCoverage } from "../src/import-coverage";
import type { D1Database, D1PreparedStatement, Env } from "../src/runtime";

const now = new Date("2026-10-13T12:00:00Z");
const a = "a".repeat(22), b = "b".repeat(22), c = "c".repeat(22);
const open: DatabaseSync[] = [];
afterEach(() => { for (const db of open.splice(0)) db.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function database() {
	const sqlite = new DatabaseSync(":memory:");
	open.push(sqlite);
	const directory = resolve("workers/spotify-stats/migrations");
	for (const file of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) sqlite.exec(readFileSync(resolve(directory, file), "utf8"));
	const DB: D1Database = {
		prepare(sql) {
			let values: (string | number | null)[] = [];
			const statement: D1PreparedStatement = {
				bind(...args) { values = args as typeof values; return statement; },
				async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
				async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...values) as T[] }; },
				async run() { sqlite.prepare(sql).run(...values); return { success: true }; },
			};
			return statement;
		},
		async batch(statements) {
			sqlite.exec("BEGIN");
			try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
			catch (error) { sqlite.exec("ROLLBACK"); throw error; }
		},
	};
	const env: Env = { DB, GENRE_ENRICHMENT_ENABLED: "true", SPOTIFY_CLIENT_ID: "test", SPOTIFY_CLIENT_SECRET: "test", SPOTIFY_REFRESH_TOKEN: "test" };
	return { DB, sqlite, env };
}
function seed(sqlite: DatabaseSync) {
	sqlite.prepare("INSERT INTO artists(spotify_artist_id,name) VALUES (?, 'Frequent'), (?, 'Main'), (?, 'A collaborator')").run(a, b, c);
	sqlite.exec("INSERT INTO tracks(spotify_track_id,name,duration_ms,history_artist_name) VALUES ('short','Short',1000,NULL),('long','Long',180000,NULL),('unknown','Unknown track',300000,'Unresolved history');");
	sqlite.prepare("INSERT INTO track_artists VALUES ('short',?,0),('long',?,0),('long',?,1)").run(a, b, c);
	for (const [track, date, time] of [["short", "2025-01-01T00:00:00.000Z", 1001], ["long", "2025-01-02T00:00:00.000Z", null], ["unknown", "2025-01-03T00:00:00.000Z", 300000]] as const) {
		sqlite.prepare("INSERT INTO plays(spotify_track_id,played_at,played_at_unix_ms,listened_ms) VALUES (?,?,?,?)").run(track, date, Date.parse(date), time);
	}
}

describe("genre attribution", () => {
	it("distinguishes incomplete audited imports from imported, live, and unverified periods", async () => {
		const { DB, sqlite } = database(); seed(sqlite);
		sqlite.prepare(`INSERT INTO history_imports(source,source_checksum,plan_fingerprint,cutoff_at,chunk_size,total_chunks,status,earliest_ended_at,latest_ended_at)
			VALUES ('spotify_extended_history','test',?,'2025-01-01T00:00:00.000Z',250,10,'running','2024-03-01T00:00:00.000Z','2024-10-01T00:00:00.000Z')`).run("f".repeat(64));
		const coverage = await getImportCoverage(DB, 2024, null);
		expect(coverage.get(0)).toBe("incomplete");
		expect(coverage.get(3)).toBe("incomplete");
		expect(coverage.get(2)).toBe("unverified");
		sqlite.exec("UPDATE history_imports SET status='completed'");
		expect((await getImportCoverage(DB, 2024, 3)).get(3)).toBe("imported");
		expect((await getImportCoverage(DB, 2025, 2)).get(2)).toBe("live");
	});
	it("normalizes duplicates while preserving display labels and rejecting malformed responses", () => {
		expect(normalizeGenres([" Rock ", "rock", " prog   rock ", ""])).toEqual([{ key: "rock", name: "rock" }, { key: "prog rock", name: "prog rock" }]);
		expect(() => normalizeGenres(["rock", 42])).toThrow();
	});
	it("keeps Other and Unknown separate and percentages reconcile", () => {
		const rows = Array.from({ length: 12 }, (_, i) => ({ month: 1, key: `genre${i}`, name: `Genre ${i}`, listeningTimeMs: i + 1 }));
		const result = genreBreakdown([...rows, { month: 1, key: null, name: null, listeningTimeMs: 100 }]);
		expect(result.genres.filter((entry) => entry.kind === "genre")).toHaveLength(10);
		expect(result.genres.find((entry) => entry.kind === "other")?.listeningTimeMs).toBe(3);
		expect(result.genres.find((entry) => entry.kind === "unknown")?.listeningTimeMs).toBe(100);
		expect(result.topGenre?.name).toBe("Genre 11");
		expect(result.genres.reduce((sum, entry) => sum + entry.sharePercent, 0)).toBeCloseTo(100);
		expect(genreBreakdown([]).genreCoverage.percentage).toBe(0);
	});
	it("splits primary-artist time, resolves monthly leaders, and preserves annual totals in real SQL", async () => {
		const { DB, sqlite } = database(); seed(sqlite);
		for (const genre of ["metal", "rock", "pop"]) sqlite.prepare("INSERT INTO artist_genres VALUES (?,?,?)").run(a, genre, genre);
		sqlite.prepare("INSERT INTO artist_genres VALUES (?, 'jazz', 'Jazz'), (?, 'blues', 'Blues')").run(b, c);
		const annual = await getTrends(DB, 2025, null, now);
		expect(annual.totals.listeningTimeMs).toBe(481001);
		expect(annual.genreCoverage.identifiedTimeMs).toBeCloseTo(181001);
		expect(annual.genreCoverage.totalTimeMs).toBeCloseTo(annual.totals.listeningTimeMs);
		expect(annual.genres.reduce((sum, entry) => sum + entry.listeningTimeMs, 0)).toBeCloseTo(481001);
		expect(annual.genres.find((entry) => entry.name === "rock")?.listeningTimeMs).toBeCloseTo(1001 / 3);
		expect(annual.genres.some((entry) => entry.name === "Blues")).toBe(false);
		expect(annual.topGenre?.name).toBe("Jazz");
		expect(annual.months![0].topGenre?.name).toBe("Jazz");
		expect(annual.months![0].topArtist?.name).toBe("Unresolved history");
		expect(annual.months![1].topArtist).toBeNull();
		const month = await getTrends(DB, 2025, 1, now);
		expect(month.genres).toEqual(annual.genres);
		expect((await getTrends(DB, 2025, 2, now)).genres).toEqual([]);
	});
});

describe("bounded genre enrichment", () => {
	it("prioritizes listening coverage, persists classifications and avoids duplicate Cron work", async () => {
		const { DB, sqlite, env } = database(); seed(sqlite);
		const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes("api/token") ? Response.json({ access_token: "token" }) : Response.json({ id: b, genres: ["Jazz", "jazz", "Soul"] }));
		await Promise.all([enrichArtistGenres(env, now, fetcher), enrichArtistGenres(env, now, fetcher)]);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(String(fetcher.mock.calls[1][0])).toContain(`/artists/${b}`);
		expect((await DB.prepare("SELECT genre_key FROM artist_genres ORDER BY genre_key").all()).results).toEqual([{ genre_key: "jazz" }, { genre_key: "soul" }]);
		const scans = vi.spyOn(DB, "prepare");
		await enrichArtistGenres(env, new Date(now.getTime() + 300000), fetcher);
		expect(fetcher).toHaveBeenCalledTimes(2);
		await enrichArtistGenres(env, new Date(now.getTime() + 3600001), vi.fn(async () => Response.json({ access_token: "token", id: a, genres: [] })));
		expect(scans.mock.calls.some(([sql]) => sql.includes("INSERT INTO artist_genre_priority"))).toBe(false);
		expect(sqlite.prepare("SELECT genres_checked_at FROM artists WHERE spotify_artist_id = ?").get(a)?.genres_checked_at).toBeTruthy();
	});
	it.each([404, 200])("marks unavailable/empty artist metadata as checked (%s)", async (status) => {
		const { sqlite, env } = database(); seed(sqlite);
		const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes("api/token") ? Response.json({ access_token: "token" }) : status === 404 ? new Response(null, { status }) : Response.json({ id: b }));
		await enrichArtistGenres(env, now, fetcher);
		expect(sqlite.prepare("SELECT genres_checked_at FROM artists WHERE spotify_artist_id = ?").get(b)?.genres_checked_at).toBe(now.toISOString());
		expect(sqlite.prepare("SELECT COUNT(*) AS n FROM artist_genres").get()?.n).toBe(0);
	});
	it("persists shared Retry-After so recommendations and genres stop fetching", async () => {
		vi.useFakeTimers(); vi.setSystemTime(now);
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { DB, sqlite, env } = database(); seed(sqlite);
		const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes("api/token") ? Response.json({ access_token: "token" }) : new Response(null, { status: 429, headers: { "Retry-After": "90000" } }));
		await enrichArtistGenres(env, now, fetcher);
		expect(sqlite.prepare("SELECT retry_after_ms FROM spotify_catalogue_state").get()?.retry_after_ms).toBe(now.getTime() + 90000000);
		await expect(new RecommendationCatalogue(env, fetcher).checkSpotifyAvailability()).rejects.toThrow();
		await enrichArtistGenres(env, new Date(now.getTime() + 3600001), fetcher);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(await reserveCatalogueRequest(DB, false, new Date(now.getTime() + 90000001))).toBe(true);
	});
	it("shares the daily 40-request cap, caps genres at twelve, and resets at UTC midnight", async () => {
		const { DB } = database();
		for (let i = 0; i < 12; i++) expect(await reserveCatalogueRequest(DB, true, now)).toBe(true);
		expect(await reserveCatalogueRequest(DB, true, now)).toBe(false);
		for (let i = 0; i < 28; i++) expect(await reserveCatalogueRequest(DB, false, now)).toBe(true);
		expect(await reserveCatalogueRequest(DB, false, now)).toBe(false);
		expect(await reserveCatalogueRequest(DB, true, new Date("2026-10-14T00:00:00Z"))).toBe(true);
		await pauseCatalogue(DB, 86400, now);
		expect(await reserveCatalogueRequest(DB, false, new Date("2026-10-14T00:00:00Z"))).toBe(false);
	});
	it("propagates a recommendation cooldown to genres and honours HTTP-date Retry-After", async () => {
		vi.useFakeTimers(); vi.setSystemTime(now);
		const { DB, sqlite, env } = database(); seed(sqlite);
		const retryAt = now.getTime() + 7200000;
		const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes("api/token")
			? Response.json({ access_token: "token" })
			: new Response(null, { status: 429, headers: { "Retry-After": new Date(retryAt).toUTCString() } }));
		await expect(new RecommendationCatalogue(env, fetcher).checkSpotifyAvailability()).rejects.toThrow();
		expect(sqlite.prepare("SELECT retry_after_ms FROM spotify_catalogue_state").get()?.retry_after_ms).toBe(retryAt);
		await enrichArtistGenres(env, now, fetcher);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(await reserveCatalogueRequest(DB, true, new Date(retryAt + 1))).toBe(true);
	});
	it("keeps ingestion committed even if genre maintenance fails", async () => {
		vi.useFakeTimers(); vi.setSystemTime(now);
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { sqlite, env } = database();
		const track = { id: "live", name: "Live track", duration_ms: 180000, artists: [{ id: a, name: "Artist" }], album: { id: "album", name: "Album" } };
		vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
			const url = String(input);
			if (url.includes("api/token")) return Response.json({ access_token: "token" });
			if (url.includes("recently-played")) return Response.json({ items: [{ track, played_at: now.toISOString() }] });
			throw new Error("Synthetic network failure");
		}));
		const pending: Promise<unknown>[] = [];
		worker.scheduled({ cron: "*/5 * * * *", scheduledTime: now.getTime() }, env, { waitUntil(promise) { pending.push(promise); } });
		await Promise.all(pending);
		expect(sqlite.prepare("SELECT COUNT(*) AS n FROM plays").get()?.n).toBe(1);
		expect(sqlite.prepare("SELECT value FROM ingestion_state").get()?.value).toBe(String(now.getTime()));
	});
});
