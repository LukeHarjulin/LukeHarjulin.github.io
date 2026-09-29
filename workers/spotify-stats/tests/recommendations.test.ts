import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { albumKey, dailyKind, editionName, groupHistory, rankRediscoveries, rediscoveryCutoff } from "../src/recommendation-ranking";
import { HISTORY_QUERY, buildRecommendations, readRecommendations, refreshRecommendations } from "../src/recommendations";
import { RecommendationCatalogue, CatalogueError } from "../src/recommendation-catalogue";
import { restoreRecommendationIndex } from "../../../src/scripts/album-recommendations";
import { routeRequest } from "../src/router";
import type { D1Database, D1PreparedStatement, Env } from "../src/runtime";
import type { AlbumRecommendation } from "../../../src/data/album-recommendation";

const now = new Date("2026-09-28T12:00:00Z");
const id = "a".repeat(22);
const pick: AlbumRecommendation = { id, name: "Album", artist: "Artist", artworkUrl: null, spotifyUrl: `https://open.spotify.com/album/${id}`, kind: "rediscovery", reason: "Worth revisiting" };
function env(DB: D1Database): Env {
	return { DB, SPOTIFY_CLIENT_ID: "client", SPOTIFY_CLIENT_SECRET: "secret", SPOTIFY_REFRESH_TOKEN: "refresh", LASTFM_API_KEY: "test-key", RECOMMENDATIONS_ENABLED: "true" };
}
function database() {
	const sqlite = new DatabaseSync(":memory:");
	const dir = resolve("workers/spotify-stats/migrations");
	for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(resolve(dir, file), "utf8"));
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
		async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
	};
	return { DB, sqlite };
}

describe("album history and ranking", () => {
	it("uses two calendar months, including clamped month ends and London midnight", () => {
		expect(rediscoveryCutoff(now)).toBe("2026-07-28");
		expect(rediscoveryCutoff(new Date("2026-04-30T12:00Z"))).toBe("2026-02-28");
		expect(rediscoveryCutoff(new Date("2026-08-31T23:30Z"))).toBe("2026-07-01");
	});
	it("merges editions, excludes recent listens and avoids single-track favourites", () => {
		const rows = ["One", "Two", "Three"].map((track) => ({ artist: "Artist", album: "Album", track, plays: 3, lastPlayed: "2026-07-28T10:00Z" }));
		rows.push({ ...rows[0], album: "Album (2015 Remaster)", track: "One - 2015 Remaster", plays: 1 });
		const grouped = groupHistory(rows);
		expect(grouped).toHaveLength(1);
		expect(grouped[0].tracks.size).toBe(3);
		expect(rankRediscoveries(grouped, now)).toHaveLength(1);
		expect(rankRediscoveries([{ ...grouped[0], lastPlayed: "2026-07-29T00:00Z" }], now)).toEqual([]);
		expect(rankRediscoveries([{ ...grouped[0], tracks: new Set(["one"]) }], now)).toEqual([]);
		expect(editionName("Album (Reissue)")).toBe(editionName("Album"));
	});
	it("reduces repeat headlines and follows an 80/10/10 headline cycle", () => {
		const albums = groupHistory(["A", "B"].flatMap((album) => ["One", "Two", "Three"].map((track) => ({ artist: album, album, track, plays: 4, lastPlayed: "2025-01-01T00:00Z" }))));
		expect(rankRediscoveries(albums, now, new Set([albumKey("A", "A")]))[0].name).toBe("B");
		const kinds = Array.from({ length: 10 }, (_, i) => dailyKind(`2026-09-${String(i + 1).padStart(2, "0")}`));
		expect(kinds.filter((kind) => kind === "rediscovery")).toHaveLength(8);
		expect(kinds.filter((kind) => kind === "exploration")).toHaveLength(1);
		expect(kinds.filter((kind) => kind === "discovery")).toHaveLength(1);
	});
	it("queries actual SQLite migrations and retains short recent plays as a recency veto", async () => {
		const { DB, sqlite } = database();
		sqlite.exec(`INSERT INTO tracks (spotify_track_id,name,duration_ms,history_artist_name,history_album_name) VALUES ('track','Song',180000,'Artist','Album');
			INSERT INTO plays (spotify_track_id,played_at,played_at_unix_ms,listened_ms) VALUES ('track','2025-01-01T00:00:00Z',1,90000),('track','2026-09-20T00:00:00Z',2,1000);`);
		expect((await DB.prepare(HISTORY_QUERY).all()).results).toEqual([{ artist: "Artist", album: "Album", track: "Song", plays: 1, lastPlayed: "2026-09-20T00:00:00Z" }]);
		sqlite.close();
	});
});

describe("stored recommendation serving and scheduled leases", () => {
	it("publishes a verified snapshot and serves its public contract", async () => {
		const { DB, sqlite } = database();
		for (let i = 0; i < 3; i++) {
			sqlite.prepare("INSERT INTO tracks (spotify_track_id,name,duration_ms,history_artist_name,history_album_name) VALUES(?,?,180000,'Artist','Album')").run(`t${i}`, `Track ${i}`);
			for (let j = 0; j < 3; j++) sqlite.prepare("INSERT INTO plays(spotify_track_id,played_at,played_at_unix_ms) VALUES(?,?,?)").run(`t${i}`, `2025-01-0${j + 1}T00:00:00Z`, j);
		}
		const fetcher = vi.fn<typeof fetch>(async (input) => {
			const url = String(input);
			const album = { id, name: "Album", artists: [{ name: "Artist" }], album_type: "album", release_date: "1990", tracks: { items: Array.from({ length: 8 }, (_, i) => ({ name: `Track ${i}`, is_playable: true })) } };
			if (url.includes("api/token")) return Response.json({ access_token: "secret-access-token" });
			if (url.includes("/search?")) return Response.json({ albums: { items: [album] } });
			if (url.includes("/albums/")) return Response.json(album);
			return Response.json({ album: { tags: { tag: [] } }, similarartists: { artist: [] } });
		});
		await refreshRecommendations(env(DB), new Date(), fetcher);
		const response = await routeRequest(new Request("https://example.com/api/spotify/recommendations"), env(DB));
		const body = await response.json();
		expect(response.status).toBe(200);
		expect(body.data.items).toHaveLength(1);
		expect(body.data.items[0]).toMatchObject({ id, kind: "rediscovery", spotifyUrl: pick.spotifyUrl });
		expect(body.data.stale).toBe(false);
		expect(JSON.stringify(body)).not.toContain("secret-access-token");
		sqlite.close();
	});
	it("serves empty, current, stale and expired snapshots without upstream requests", async () => {
		const { DB, sqlite } = database();
		expect((await readRecommendations(DB, now)).items).toEqual([]);
		sqlite.prepare("INSERT INTO album_recommendation_days(date,generated_at,payload) VALUES(?,?,?)").run("2026-09-28", now.toISOString(), JSON.stringify([pick]));
		expect((await readRecommendations(DB, now)).stale).toBe(false);
		expect((await readRecommendations(DB, new Date("2026-09-29T12:00Z"))).stale).toBe(true);
		expect((await readRecommendations(DB, new Date("2026-10-02T12:00Z"))).items).toEqual([]);
		const fetcher = vi.fn();
		await refreshRecommendations(env(DB), now, fetcher);
		expect(fetcher).not.toHaveBeenCalled();
		sqlite.close();
	});
	it("checks Spotify before scanning history and limits retries when Spotify is unavailable", async () => {
		const { DB, sqlite } = database();
		const spy = vi.spyOn(DB, "prepare");
		const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes("api/token")
			? Response.json({ access_token: "token" }) : new Response(null, { status: 503 }));
		await Promise.all([refreshRecommendations(env(DB), now, fetcher), refreshRecommendations(env(DB), now, fetcher)]);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(spy.mock.calls.filter(([sql]) => sql === HISTORY_QUERY)).toHaveLength(0);
		await refreshRecommendations(env(DB), new Date(now.getTime() + 300000), fetcher);
		expect(fetcher).toHaveBeenCalledTimes(2);
		await refreshRecommendations(env(DB), new Date(now.getTime() + 7200001), fetcher);
		expect(fetcher).toHaveBeenCalledTimes(4);
		expect(spy.mock.calls.filter(([sql]) => sql === HISTORY_QUERY)).toHaveLength(0);
		sqlite.close();
	});
	it("scans history only once per day when no catalogue picks can be built", async () => {
		const { DB, sqlite } = database();
		const spy = vi.spyOn(DB, "prepare");
		const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes("api/token")
			? Response.json({ access_token: "token" }) : Response.json({ albums: { items: [] } }));
		await refreshRecommendations(env(DB), now, fetcher);
		await refreshRecommendations(env(DB), new Date(now.getTime() + 7200001), fetcher);
		expect(spy.mock.calls.filter(([sql]) => sql === HISTORY_QUERY)).toHaveLength(1);
		sqlite.close();
	});
	it("keeps the endpoint read-only and supports disabled operation before migrations", async () => {
		const { DB, sqlite } = database();
		const environment = env(DB);
		environment.RECOMMENDATIONS_ENABLED = "false";
		const spy = vi.spyOn(DB, "prepare");
		const response = await routeRequest(new Request("https://example.com/api/spotify/recommendations"), environment);
		expect((await response.json()).data.items).toEqual([]);
		expect(spy).not.toHaveBeenCalled();
		expect((await routeRequest(new Request("https://example.com/api/spotify/recommendations", { method: "POST" }), environment)).status).toBe(405);
		sqlite.close();
	});
});

describe("catalogue verification", () => {
	const album = { id, name: "Album", artists: [{ name: "Artist" }], album_type: "album", release_date: "1990-01-01", tracks: { items: Array.from({ length: 8 }, (_, i) => ({ name: `Track ${i}`, is_playable: true })) } };
	function fetcher(override: Record<string, unknown> = {}, tags: string[] = []) {
		return vi.fn<typeof fetch>(async (input) => {
			const url = String(input);
			if (url.includes("api/token")) return Response.json({ access_token: "token" });
			if (url.includes("/search?")) return Response.json({ albums: { items: [album] } });
			if (url.includes("/albums/")) return Response.json({ ...album, ...override });
			return Response.json({ album: { tags: { tag: tags.map((name) => ({ name })) } } });
		});
	}
	it("returns a direct verified link and reuses its token and verified metadata", async () => {
		const { DB, sqlite } = database();
		const fetch = fetcher();
		const catalogue = new RecommendationCatalogue(env(DB), fetch);
		expect((await catalogue.verify("Artist", "Album"))?.spotifyUrl).toBe(`https://open.spotify.com/album/${id}`);
		await catalogue.verify("Artist", "Album (Remastered)");
		expect(fetch).toHaveBeenCalledTimes(4);
		sqlite.close();
	});
	it("rejects unavailable, compilation and live albums even when the title looks ordinary", async () => {
		const { DB, sqlite } = database();
		for (const override of [{ restrictions: { reason: "market" } }, { album_type: "compilation" }, { tracks: { items: album.tracks.items.map((track) => ({ ...track, is_playable: false })) } }]) {
			expect(await new RecommendationCatalogue(env(DB), fetcher(override)).verify("Artist", "Album")).toBeNull();
		}
		expect(await new RecommendationCatalogue(env(DB), fetcher({}, ["live"])).verify("Artist", "Album")).toBeNull();
		expect(await new RecommendationCatalogue(env(DB), fetcher()).verify("Different artist", "Album")).toBeNull();
		sqlite.close();
	});
	it("reports rate limits without leaking the Last.fm key", async () => {
		const { DB, sqlite } = database();
		const catalogue = new RecommendationCatalogue(env(DB), async () => new Response(null, { status: 429, headers: { "Retry-After": "7200" } }));
		await expect(catalogue.topAlbums("Artist")).rejects.toMatchObject({ status: 429, retrySeconds: 7200 });
		sqlite.close();
	});
	it("preserves already-verified picks if a later lookup fails", async () => {
		const { DB, sqlite } = database();
		const catalogue = new RecommendationCatalogue(env(DB), fetcher());
		vi.spyOn(catalogue, "verify").mockResolvedValueOnce({ ...pick, year: 1990, tracks: ["one", "two", "three"] }).mockRejectedValue(new CatalogueError("Spotify", 429));
		const history = groupHistory(["Artist", "Other"].flatMap((artist) => ["One", "Two", "Three"].map((track) => ({ artist, album: "Album", track, plays: 10, lastPlayed: "2025-01-01T00:00Z" }))));
		expect(await buildRecommendations(history, catalogue, now, new Set())).toHaveLength(1);
		sqlite.close();
	});
});

describe("browser-local alternatives", () => {
	it("restores the selected album only for the same daily snapshot", () => {
		const data = { date: "2026-09-28", generatedAt: now.toISOString(), stale: false, items: [pick, { ...pick, id: "b".repeat(22) }] };
		const raw = JSON.stringify({ date: data.date, generatedAt: data.generatedAt, id: data.items[1].id });
		expect(restoreRecommendationIndex(raw, data)).toBe(1);
		expect(restoreRecommendationIndex(raw, { ...data, date: "2026-09-29" })).toBe(0);
		expect(restoreRecommendationIndex("invalid", data)).toBe(0);
		expect(restoreRecommendationIndex(raw, { ...data, items: [pick] })).toBe(0);
	});
});
