import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarRange, parseTrendsMonth, parseTrendsYear } from "../src/periods";
import { routeRequest } from "../src/router";
import { getTrends } from "../src/trends";
import type { D1Database, Env } from "../src/runtime";

const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
const now = new Date("2026-10-13T12:00:00Z");
afterEach(() => vi.useRealTimers());

describe("calendar trend input", () => {
	it("validates years and months without silently accepting malformed values", () => {
		expect(parseTrendsYear(null, now)).toBe(2026);
		for (const value of ["", "2005", "2027", "2025x", "2025.0", " 2025", "02025"]) expect(parseTrendsYear(value, now)).toBeNull();
		expect(parseTrendsYear("2006", now)).toBe(2006);
		expect(parseTrendsMonth("03")).toBe(3);
		for (const value of [null, "", "0", "13", "1.5", "1x", "001"]) expect(parseTrendsMonth(value)).toBeNull();
	});
	it("isolates London months across both DST transitions and leap years", () => {
		expect(calendarRange(2026, 3)).toEqual({ start: "2026-03-01T00:00:00.000Z", end: "2026-03-31T23:00:00.000Z" });
		expect(calendarRange(2026, 10)).toEqual({ start: "2026-09-30T23:00:00.000Z", end: "2026-11-01T00:00:00.000Z" });
		expect(calendarRange(2024, 2)).toEqual({ start: "2024-02-01T00:00:00.000Z", end: "2024-03-01T00:00:00.000Z" });
		expect(calendarRange(2025, 12).end).toBe(calendarRange(2026).start);
		expect(calendarRange(2026).end).toBe("2027-01-01T00:00:00.000Z");
	});
	it("rejects invalid selections before touching D1", async () => {
		vi.useFakeTimers(); vi.setSystemTime(now);
		const prepare = vi.fn();
		const env = { DB: { prepare }, PUBLIC_SITE_ORIGIN: "https://www.example.com" } as unknown as Env;
		for (const [query, code] of [["year=2027", "INVALID_YEAR"], ["year=2025&month=13", "INVALID_MONTH"], ["month=", "INVALID_MONTH"]]) {
			const response = await routeRequest(new Request(`https://api.example.com/api/spotify/trends?${query}`), env);
			expect(response.status).toBe(400);
			expect((await response.json()).error.code).toBe(code);
		}
		expect(prepare).not.toHaveBeenCalled();
	});
});

describe("D1 calendar trends", () => {
	it("reconciles monthly and annual totals, ranks by time, and returns bounded aggregates", async () => {
		const mf = new Miniflare(convertV4MiniflareOptions({
			modules: true, script: "export default { fetch() { return new Response('test'); } };",
			compatibilityDate: "2026-08-27", d1Databases: ["DB"],
		}));
		try {
			const nativeDb = await mf.getD1Database("DB");
			for (const file of ["0001_initial.sql", "0002_history_import.sql", "0003_history_import_progress.sql", "0004_history_metadata_fallback.sql", "0005_artist_lookup_index.sql", "0006_artist_genres.sql"]) {
				const sql = await readFile(`workers/spotify-stats/migrations/${file}`, "utf8");
				await nativeDb.exec(sql.split("\n").filter((line) => !line.trim().startsWith("--")).join(" "));
			}
			const db = nativeDb as unknown as D1Database;
			const fresh = await getTrends(db, 2026, null, now);
			expect(fresh.availableYears).toEqual([2026]);
			expect(fresh.totals).toEqual({ plays: 0, listeningTimeMs: 0, uniqueArtists: 0, uniqueTracks: 0, recordedTimeMs: 0, estimatedTimeMs: 0 });
			expect(fresh.months).toHaveLength(12);
			await nativeDb.exec(`
				INSERT INTO artists(spotify_artist_id,name) VALUES ('a','Frequent'),('b','Long listen'),('c','Collaborator');
				INSERT INTO tracks(spotify_track_id,name,duration_ms,history_artist_name) VALUES ('t1','Short',10000,NULL),('t2','Long',180000,NULL),('t3','Fallback',50000,'Export artist');
				INSERT INTO track_artists VALUES ('t1','a',0),('t2','b',0),('t2','c',1);
			`.replaceAll("\n", " "));
			const events: [string, string, number | null][] = [
				['t2', '2024-12-31T23:59:59.999Z', 999999],
				['t1', '2025-01-01T00:00:00.000Z', 1000],
				['t1', '2025-03-01T00:00:00.000Z', 1000],
				['t1', '2025-03-31T22:59:59.999Z', 1000],
				['t2', '2025-03-31T23:00:00.000Z', null],
				['t3', '2025-10-25T23:30:00.000Z', 25000],
				['t1', '2025-10-26T01:30:00.000Z', 0],
				['t1', '2025-12-31T23:59:59.999Z', 1000],
				['t2', '2026-01-01T00:00:00.000Z', 999999],
			];
			await nativeDb.batch(events.map(([track, date, listened]) => nativeDb.prepare(
				"INSERT INTO plays(spotify_track_id,played_at,played_at_unix_ms,listened_ms) VALUES (?, ?, ?, ?)",
			).bind(track, date, Date.parse(date), listened)));
			await nativeDb.exec("INSERT INTO artist_genres VALUES ('a','rock','Rock'),('a','pop','Pop'),('b','jazz','Jazz'),('c','metal','Metal');");
			const annual = await getTrends(db, 2025, null, now);
			expect(annual.availableYears).toEqual([2026, 2025, 2024]);
			expect(annual.totals).toEqual({ plays: 7, listeningTimeMs: 209000, uniqueArtists: 4, uniqueTracks: 3, recordedTimeMs: 29000, estimatedTimeMs: 180000 });
			expect(annual.months).toHaveLength(12);
			expect(annual.topGenre?.name).toBe("Jazz");
			expect(annual.genreCoverage.identifiedTimeMs).toBe(184000);
			expect(annual.genreCoverage.totalTimeMs).toBe(annual.totals.listeningTimeMs);
			expect(annual.genres.some((entry) => entry.name === "Metal")).toBe(false);
			expect(annual.months!.reduce((sum, m) => sum + m.plays, 0)).toBe(annual.totals.plays);
			expect(annual.months!.reduce((sum, m) => sum + m.listeningTimeMs, 0)).toBe(annual.totals.listeningTimeMs);
			expect(annual.months![1].plays).toBe(0);
			expect(annual.months![2].plays).toBe(2);
			expect(annual.months![3].plays).toBe(1);
			expect(annual.tracks[0].track.id).toBe('t2');
			expect((annual.artists[0] as { id: string }).id).toBe('c');
			expect(annual.months![3].topArtist?.id).toBe('c');
			// Both credited artists receive the collaborative track's full time.
			expect(annual.artists.slice(0, 2)).toMatchObject([{ listeningTimeMs: 180000 }, { listeningTimeMs: 180000 }]);
			const march = await getTrends(db, 2025, 3, now);
			expect(march.totals).toEqual({ plays: 2, listeningTimeMs: 2000, uniqueArtists: 1, uniqueTracks: 1, recordedTimeMs: 2000, estimatedTimeMs: 0 });
			expect(march).not.toHaveProperty('months');
			const empty = await getTrends(db, 2025, 2, now);
			expect(empty.totals.plays).toBe(0);
			expect(empty.artists).toEqual([]);
			expect(empty.tracks).toEqual([]);
			const current = await getTrends(db, 2026, null, now);
			expect(current.isToDate).toBe(true);
			expect(current.months![9]).toMatchObject({ isToDate: true, isUpcoming: false });
			expect(current.months![10]).toMatchObject({ plays: 0, isToDate: false, isUpcoming: true });
			expect((await getTrends(db, 2026, 11, now)).isUpcoming).toBe(true);
			const response = await routeRequest(new Request('https://api.example.com/api/spotify/trends?year=2025&month=3'), { DB: db } as Env);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ data: { year: 2025, month: 3, timeZone: 'Europe/London', totals: march.totals }, meta: { period: '2025-03', generatedAt: expect.any(String) } });
			const serialized = JSON.stringify(annual);
			for (const privateField of ['played_at', 'source_event_key', 'context_uri', '2025-03-31T23:00:00']) expect(serialized).not.toContain(privateField);
		} finally { await mf.dispose(); }
	}, 60_000);
});
