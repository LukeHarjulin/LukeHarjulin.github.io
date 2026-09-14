import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as repository from "../src/repository";
import type { D1Database, D1PreparedStatement } from "../src/runtime";

const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
const { build } = createRequire(require.resolve("wrangler/package.json"))("esbuild");

async function capture(invoke: (db: D1Database) => Promise<unknown>) {
	let query = "";
	let bindings: unknown[] = [];
	const statement: D1PreparedStatement = {
		bind(...values) { bindings = values; return this; },
		async first() { return null; },
		async all() { return { success: true, results: [] }; },
		async run() { return { success: true, results: [] }; },
	};
	await invoke({ prepare(sql) { query = sql; return statement; }, async batch() { return []; } });
	return { query, bindings };
}

describe("D1 query correctness and row-read regression", () => {
	it("preserves historical results while reducing recent/ranking reads on a populated archive", async () => {
		const bundle = await build({
			entryPoints: ["workers/spotify-stats/src/index.ts"], bundle: true,
			format: "esm", write: false, platform: "browser",
		});
		const mf = new Miniflare(convertV4MiniflareOptions({
			modules: true, script: bundle.outputFiles[0].text,
			compatibilityDate: "2026-08-27", d1Databases: ["DB"],
			bindings: { PUBLIC_SITE_ORIGIN: "https://www.example.com" },
		}));
		try {
			const db = await mf.getD1Database("DB");
			const migrate = async (file: string) => {
				const sql = await readFile(`workers/spotify-stats/migrations/${file}`, "utf8");
				await db.exec(sql.split("\n").filter((line) => !line.trim().startsWith("--")).join(" "));
			};
			for (const file of ["0001_initial.sql", "0002_history_import.sql", "0003_history_import_progress.sql", "0004_history_metadata_fallback.sql"]) await migrate(file);
			// Includes unambiguous/ambiguous historical names, missing metadata,
			// enriched tracks, multiple artists and both imported/live durations.
			await db.exec(`
WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1200)
INSERT INTO artists(spotify_artist_id,name) SELECT 'a'||x, 'Artist '||x FROM n;
INSERT INTO artists(spotify_artist_id,name) VALUES ('duplicate','Artist 2');
WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1200)
INSERT INTO tracks(spotify_track_id,name,duration_ms,history_artist_name,history_album_name)
SELECT 't'||x, printf('Track %04d',x), 180000,
CASE WHEN x%7=0 THEN NULL WHEN x%3=0 THEN 'Unknown '||x ELSE ' artist '||x||' ' END, 'History album' FROM n;
WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1200)
INSERT INTO track_artists SELECT 't'||x, 'a'||x, 0 FROM n WHERE x%5=0;
INSERT INTO track_artists VALUES ('t5','a1',1);
WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<24000)
INSERT INTO plays(spotify_track_id,played_at,played_at_unix_ms,listened_ms)
SELECT 't'||(x%1200+1), strftime('%Y-%m-%dT%H:%M:%fZ',1788220800+x*60,'unixepoch'),
(1788220800+x*60)*1000, CASE WHEN x%4=0 THEN NULL WHEN x%9=0 THEN 0 ELSE 60000 END FROM n;
`.replaceAll("\n", " "));
			const columns = (await readFile("workers/spotify-stats/tests/fixtures/legacy-track-columns.sql", "utf8")).trim();
			const source = await readFile("workers/spotify-stats/src/repository.ts", "utf8");
			const currentColumns = source.match(/const TRACK_COLUMNS = `([\s\S]*?)`;/)![1];
			const legacyRecent = `SELECT ${columns}, p.played_at AS playedAt FROM tracks t
				LEFT JOIN albums a ON a.spotify_album_id=t.spotify_album_id
				JOIN plays p ON p.spotify_track_id=t.spotify_track_id ORDER BY p.played_at DESC LIMIT ?`;
			const legacyTop = (filtered: boolean) => `SELECT ${columns}, COUNT(*) AS plays,
				COALESCE(SUM(COALESCE(p.listened_ms, t.duration_ms)),0) AS listeningTimeMs FROM tracks t
				LEFT JOIN albums a ON a.spotify_album_id=t.spotify_album_id
				JOIN plays p ON p.spotify_track_id=t.spotify_track_id
				WHERE ${filtered ? "p.played_at >= ?" : "1=1"}
				GROUP BY t.spotify_track_id ORDER BY COUNT(*) DESC,t.name COLLATE NOCASE LIMIT ?`;
			const start = "2026-09-10T00:00:00.000Z";
			const cases = [
				{ name: "latest", invoke: (d: D1Database) => repository.getMostRecentPlay(d), old: legacyRecent, args: [1] },
				{ name: "recent", invoke: (d: D1Database) => repository.getRecentPlays(d,20), old: legacyRecent, args: [20] },
				{ name: "all-metadata", invoke: (d: D1Database) => repository.getRecentPlays(d,1200), old: legacyRecent, args: [1200] },
				{ name: "top-all", invoke: (d: D1Database) => repository.getTopTracks(d,null,10), old: legacyTop(false), args: [10] },
				{ name: "top-period", invoke: (d: D1Database) => repository.getTopTracks(d,start,10), old: legacyTop(true), args: [start,10] },
				{ name: "lifetime", invoke: (d: D1Database) => repository.getLifetimeTotals(d) },
				{ name: "summary", invoke: (d: D1Database) => repository.getSummary(d,start) },
				{ name: "artists", invoke: (d: D1Database) => repository.getTopArtists(d,null,10) },
				{ name: "search", invoke: (d: D1Database) => repository.searchArchive(d,"Track 00",10,start,start) },
				{ name: "empty-top", invoke: (d: D1Database) => repository.getTopTracks(d,"2099-01-01",10), old: legacyTop(true), args: ["2099-01-01",10] },
			];
			const measured = [];
			for (const item of cases) {
				const current = await capture(item.invoke);
				const before = await db.prepare(item.old ?? current.query.replace(currentColumns, columns)).bind(...(item.args ?? current.bindings)).all();
				measured.push({ ...item, current, before });
			}
			const artistRows = await db.prepare("SELECT * FROM reporting_track_artists ORDER BY spotify_track_id,artist_order").all();
			await migrate("0005_artist_lookup_index.sql");
			expect((await db.prepare("SELECT * FROM reporting_track_artists ORDER BY spotify_track_id,artist_order").all()).results).toEqual(artistRows.results);
			for (const item of measured) {
				const after = await db.prepare(item.current.query).bind(...item.current.bindings).all();
				expect(after.results, item.name).toEqual(item.before.results);
				console.log(`${item.name}: ${item.before.meta.rows_read} -> ${after.meta.rows_read} rows read`);
				if (["latest", "recent", "top-all", "top-period"].includes(item.name)) {
					expect(after.meta.rows_read, item.name).toBeLessThan(item.before.meta.rows_read * 0.5);
				}
			}
			// Exercise the actual bundled fetch handler and runtime Cache API.
			const url = "https://api.example.com/api/spotify/lifetime";
			const first = await mf.dispatchFetch(url, { headers: { Origin: "https://www.example.com" } });
			expect(first.headers.get("X-Spotify-Cache")).toBe("MISS");
			const firstBody = await first.json();
			await expect.poll(async () => {
				const hit = await mf.dispatchFetch(url, { headers: { Origin: "https://www.example.com" } });
				expect(await hit.json()).toEqual(firstBody);
				expect(hit.headers.get("Access-Control-Allow-Origin")).toBe("https://www.example.com");
				return hit.headers.get("X-Spotify-Cache");
			}).toBe("HIT");
		} finally { await mf.dispose(); }
	}, 120_000);
});
