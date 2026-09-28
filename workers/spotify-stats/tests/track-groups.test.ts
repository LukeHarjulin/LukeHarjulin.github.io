import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { D1Database, D1PreparedStatement } from "../src/runtime";
import { getTopTracks, searchArchive, getSummary, getLifetimeTotals, getRecentPlays } from "../src/repository";
import { songKey, songTitle } from "../src/track-groups";
import type { PublicTrack } from "../src/types";

describe("song identity", () => {
	it.each(["Song - Remastered", "Song - 2011 Remaster", "Song (Remastered 2011)", "Song [2011 Remastered]", "Song – Digitally Remastered"])("recognizes %s", (title) => {
		expect(songTitle(title)).toBe("Song");
	});
	it.each(["Song - Live", "Song (Acoustic)", "Song - Remix", "Song - Radio Edit", "Song - Remastered Live", "Remastered"])("preserves %s", (title) => {
		expect(songTitle(title)).toBe(title);
	});
	it("uses artist IDs, explicit status and conservative title matching", () => {
		const track = { id: "one", name: "Song", artists: [{ id: "artist", name: "Artist" }] } as PublicTrack;
		expect(songKey(track, false)).toBe(songKey({ ...track, id: "two", name: " SONG - 2011 Remaster " }, false));
		expect(songKey(track, false)).not.toBe(songKey(track, true));
		expect(songKey(track, false)).not.toBe(songKey({ ...track, artists: [{ id: "other", name: "Artist" }] }, false));
		expect(songKey({ ...track, artists: [] }, false)).not.toBe(songKey({ ...track, id: "two", artists: [] }, false));
	});
});

function fixture() {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
	sqlite.exec(`INSERT INTO artists (spotify_artist_id, name) VALUES ('artist', 'Artist');
		INSERT INTO albums (spotify_album_id, name) VALUES ('album', 'Album');`);
	const db: D1Database = {
		prepare(sql) {
			let values: unknown[] = [];
			const statement: D1PreparedStatement = {
				bind(...args) { values = args; return statement; },
				async first<T>() { return (sqlite.prepare(sql).get(...values as []) ?? null) as T | null; },
				async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...values as []) as T[] }; },
				async run() { sqlite.prepare(sql).run(...values as []); return { success: true }; },
			};
			return statement;
		},
		async batch() { throw new Error("Not used"); },
	};
	function add(id: string, name: string, duration: number, dates: string[]) {
		sqlite.prepare("INSERT INTO tracks (spotify_track_id, spotify_album_id, name, duration_ms) VALUES (?, 'album', ?, ?)").run(id, name, duration);
		sqlite.prepare("INSERT INTO track_artists VALUES (?, 'artist', 0)").run(id);
		for (const date of dates) sqlite.prepare("INSERT INTO plays (spotify_track_id, played_at, played_at_unix_ms) VALUES (?, ?, ?)").run(id, date, Date.parse(date));
	}
	add("original", "Song", 180000, ["2025-01-01T10:00:00.000Z", "2026-09-01T10:00:00.000Z"]);
	add("remaster", "Song - 2011 Remaster", 181000, ["2026-09-02T10:00:00.000Z", "2026-09-03T10:00:00.000Z"]);
	add("other", "Other", 100000, ["2026-09-01T11:00:00.000Z", "2026-09-02T11:00:00.000Z", "2026-09-03T11:00:00.000Z"]);
	return { db, sqlite };
}

describe("grouped repository queries against SQLite", () => {
	it("combines before limiting, preserves actual durations, and respects periods", async () => {
		const { db, sqlite } = fixture();
		try {
			const [top] = await getTopTracks(db, null, 1);
			expect(top).toMatchObject({ track: { id: "original", name: "Song", versionIds: ["original", "remaster"] }, plays: 4, listeningTimeMs: 722000 });
			expect((await getTopTracks(db, "2026-09-02T00:00:00.000Z", 10)).find((row) => row.track.id === "remaster")?.plays).toBe(2);
			expect(await getSummary(db, null)).toEqual({ plays: 7, listeningTimeMs: 1022000, uniqueArtists: 1, uniqueTracks: 2 });
			expect(await getSummary(db, "2027-01-01T00:00:00.000Z")).toEqual({ plays: 0, listeningTimeMs: 0, uniqueArtists: 0, uniqueTracks: 0 });
			expect(await getLifetimeTotals(db)).toMatchObject({ plays: 7, uniqueTracks: 2 });
		} finally { sqlite.close(); }
	});
	it("searches every version but returns the entire group's history", async () => {
		const { db, sqlite } = fixture();
		try {
			const results = await searchArchive(db, "2011 Remaster", 1, "2026-01-01", "2026-09-01");
			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({ track: { name: "Song" }, totalPlays: 4, playsThisYear: 3, playsThisMonth: 3, totalListeningTimeMs: 722000, firstPlayed: "2025-01-01T10:00:00.000Z", lastPlayed: "2026-09-03T10:00:00.000Z" });
			expect(await searchArchive(db, "%", 10, "2026-01-01", "2026-09-01")).toEqual([]);
			const recent = await getRecentPlays(db, 10);
			expect(recent).toHaveLength(7);
			expect(recent.find((row) => row.track.id === "remaster")?.track.name).toBe("Song - 2011 Remaster");
			expect(recent.every((row) => !row.track.versionIds)).toBe(true);
		} finally { sqlite.close(); }
	});
});
