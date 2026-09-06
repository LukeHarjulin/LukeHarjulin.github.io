import { describe, expect, it } from "vitest";
import {
	getActivity,
	getLifetimeTotals,
	getSummary,
	getTopArtists,
	getTopTracks,
	searchArchive,
} from "../src/repository";
import type { D1Database, D1PreparedStatement, D1Result } from "../src/runtime";

interface CapturedStatement {
	query: string;
	bindings: unknown[];
}

class QueryCaptureStatement implements D1PreparedStatement {
	constructor(private readonly captured: CapturedStatement) {}

	bind(...values: unknown[]): D1PreparedStatement {
		this.captured.bindings = values;
		return this;
	}

	async first<T = unknown>(): Promise<T | null> {
		return null;
	}

	async all<T = unknown>(): Promise<D1Result<T>> {
		return { success: true, results: [] };
	}

	async run<T = unknown>(): Promise<D1Result<T>> {
		return { success: true, results: [] };
	}
}

class QueryCaptureDatabase implements D1Database {
	readonly statements: CapturedStatement[] = [];

	prepare(query: string): D1PreparedStatement {
		const captured = { query: query.replace(/\s+/g, " ").trim(), bindings: [] };
		this.statements.push(captured);
		return new QueryCaptureStatement(captured);
	}

	async batch<T = unknown>(): Promise<D1Result<T>[]> {
		return [];
	}
}

describe("history-aware listening duration queries", () => {
	it("prefers each play's listened duration in every listening-time calculation", async () => {
		const db = new QueryCaptureDatabase();

		await getSummary(db, null);
		await getTopArtists(db, null, 10);
		await getTopTracks(db, null, 10);
		await getActivity(db, null);
		await searchArchive(db, "track", 10, "2026-01-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
		await getLifetimeTotals(db);

		expect(db.statements).toHaveLength(6);
		expect(db.statements.map(({ query }) => query)).toEqual([
			expect.stringContaining("SUM(COALESCE(fp.listened_ms, t.duration_ms))"),
			expect.stringContaining("SUM(COALESCE(p.listened_ms, t.duration_ms))"),
			expect.stringContaining("SUM(COALESCE(p.listened_ms, t.duration_ms))"),
			expect.stringContaining("COALESCE(p.listened_ms, t.duration_ms) AS durationMs"),
			expect.stringContaining("SUM(COALESCE(p.listened_ms, t.duration_ms))"),
			expect.stringContaining("SUM(COALESCE(p.listened_ms, t.duration_ms))"),
		]);
		for (const { query } of db.statements) {
			expect(query).not.toMatch(/SUM\(t\.duration_ms\)/);
		}
	});

	it("preserves period, search, and limit bindings", async () => {
		const db = new QueryCaptureDatabase();
		const periodStart = "2026-08-25T00:00:00.000Z";

		await getSummary(db, periodStart);
		await getTopArtists(db, periodStart, 7);
		await getTopTracks(db, periodStart, 8);
		await getActivity(db, periodStart);
		await searchArchive(db, "100%_mix", 9, "2026-01-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");

		expect(db.statements.map(({ bindings }) => bindings)).toEqual([
			[periodStart],
			[periodStart, 7],
			[periodStart, 8],
			[periodStart],
			["2026-01-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z", "%100\\%\\_mix%", 9],
		]);
	});

	it("uses reporting artist identities and fallback album metadata in public queries", async () => {
		const db = new QueryCaptureDatabase();

		await getSummary(db, null);
		await getTopArtists(db, null, 10);
		await getTopTracks(db, null, 10);
		await searchArchive(db, "track", 10, "2026-01-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
		await getLifetimeTotals(db);

		const [summary, topArtists, topTracks, archive, lifetime] = db.statements.map(({ query }) => query);
		expect(summary).toContain("COUNT(DISTINCT artist.artist_id)");
		expect(summary).toContain("JOIN reporting_track_artists artist");
		expect(topArtists).toContain("JOIN reporting_track_artists artist");
		expect(topArtists).toContain("GROUP BY artist.artist_id, artist.name, artist.spotify_url");
		expect(topTracks).toContain("LEFT JOIN albums a");
		expect(topTracks).toContain("COALESCE(a.name, t.history_album_name, '') AS albumName");
		expect(topTracks).toContain("FROM reporting_track_artists ordered_artist");
		expect(topTracks).toContain("ORDER BY ordered_artist.artist_order");
		expect(archive).toContain("LEFT JOIN albums a");
		expect(archive).toContain("FROM reporting_track_artists ordered_artist");
		expect(lifetime).toContain("COUNT(DISTINCT artist.artist_id)");
	});
});
