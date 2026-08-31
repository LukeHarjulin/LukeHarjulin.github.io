import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type {
	D1Database,
	D1PreparedStatement,
	D1Result,
	Env,
	ExecutionContextLike,
	ScheduledControllerLike,
} from "../src/runtime";
import type { SpotifyPlayItem } from "../src/types";

const CURSOR_KEY = "recently_played_after_ms";

class TestStatement implements D1PreparedStatement {
	values: unknown[] = [];

	constructor(
		readonly database: TestDatabase,
		readonly query: string,
	) {}

	bind(...values: unknown[]): D1PreparedStatement {
		this.values = values;
		return this;
	}

	async first<T = unknown>(column?: string): Promise<T | null> {
		return this.database.first<T>(this, column);
	}

	async all<T = unknown>(): Promise<D1Result<T>> {
		return { success: true, results: [] };
	}

	async run<T = unknown>(): Promise<D1Result<T>> {
		this.database.execute(this);
		return { success: true, results: [] };
	}
}

class TestDatabase implements D1Database {
	readonly albums = new Set<string>();
	readonly artists = new Set<string>();
	readonly tracks = new Set<string>();
	readonly trackArtists = new Set<string>();
	readonly plays = new Set<string>();
	readonly ingestionState = new Map<string, string>();
	batchCalls = 0;

	prepare(query: string): D1PreparedStatement {
		return new TestStatement(this, query);
	}

	async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
		this.batchCalls += 1;
		return statements.map((statement) => {
			this.execute(statement as TestStatement);
			return { success: true, results: [] as T[] };
		});
	}

	first<T>(statement: TestStatement, column?: string): T | null {
		const sql = normalizeSql(statement.query);
		if (!sql.startsWith("SELECT VALUE FROM INGESTION_STATE")) {
			throw new Error(`Unexpected first() query: ${sql}`);
		}

		const value = this.ingestionState.get(String(statement.values[0]));
		if (value === undefined) return null;
		return (column === "value" ? value : { value }) as T;
	}

	execute(statement: TestStatement): void {
		const sql = normalizeSql(statement.query);
		const values = statement.values;

		if (sql.startsWith("INSERT INTO ALBUMS")) {
			this.albums.add(String(values[0]));
			return;
		}
		if (sql.startsWith("INSERT INTO ARTISTS")) {
			this.artists.add(String(values[0]));
			return;
		}
		if (sql.startsWith("INSERT INTO TRACKS")) {
			this.tracks.add(String(values[0]));
			return;
		}
		if (sql.startsWith("DELETE FROM TRACK_ARTISTS")) {
			const trackPrefix = `${String(values[0])}\u0000`;
			for (const relationship of this.trackArtists) {
				if (relationship.startsWith(trackPrefix)) this.trackArtists.delete(relationship);
			}
			return;
		}
		if (sql.startsWith("INSERT INTO TRACK_ARTISTS")) {
			this.trackArtists.add(`${String(values[0])}\u0000${String(values[1])}`);
			return;
		}
		if (sql.startsWith("INSERT OR IGNORE INTO PLAYS")) {
			this.plays.add(`${String(values[0])}\u0000${String(values[1])}`);
			return;
		}
		if (sql.startsWith("INSERT INTO INGESTION_STATE")) {
			this.ingestionState.set(String(values[0]), String(values[1]));
			return;
		}

		throw new Error(`Unexpected batch query: ${sql}`);
	}
}

function normalizeSql(query: string): string {
	return query.replace(/\s+/g, " ").trim().toUpperCase();
}

function play(playedAt: string): SpotifyPlayItem {
	return {
		played_at: playedAt,
		context: { type: "playlist", uri: "spotify:playlist:test" },
		track: {
			id: "track-1",
			name: "Scheduled test track",
			duration_ms: 180000,
			explicit: false,
			external_urls: { spotify: "https://open.spotify.com/track/track-1" },
			artists: [
				{ id: "artist-1", name: "First artist" },
				{ id: "artist-2", name: "Second artist" },
			],
			album: {
				id: "album-1",
				name: "Scheduled test album",
				album_type: "album",
				release_date: "2026-08-31",
				images: [{ url: "https://images.example/album.jpg" }],
			},
		},
	};
}

function environment(database: TestDatabase): Env {
	return {
		DB: database,
		SPOTIFY_CLIENT_ID: "client-id",
		SPOTIFY_CLIENT_SECRET: "client-secret",
		SPOTIFY_REFRESH_TOKEN: "refresh-token",
	};
}

async function runScheduled(env: Env): Promise<unknown> {
	const pending: Promise<unknown>[] = [];
	const context: ExecutionContextLike = {
		waitUntil(promise) {
			pending.push(promise);
		},
	};
	const controller: ScheduledControllerLike = {
		cron: "*/5 * * * *",
		scheduledTime: Date.parse("2026-08-31T12:00:00.000Z"),
	};

	expect(worker.scheduled(controller, env, context)).toBeUndefined();
	expect(pending).toHaveLength(1);
	return pending[0];
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("scheduled recently-played ingestion", () => {
	it("persists normalized records idempotently and reuses the newest play cursor", async () => {
		const database = new TestDatabase();
		const olderPlay = play("2026-08-31T11:55:00.000Z");
		const newerPlay = play("2026-08-31T11:58:00.000Z");
		const recentlyPlayedUrls: URL[] = [];
		const fetcher = vi.fn<typeof fetch>(async (input) => {
			const url = new URL(String(input));
			if (url.hostname === "accounts.spotify.com") {
				return Response.json({ access_token: "access-token" });
			}

			recentlyPlayedUrls.push(url);
			return Response.json({ items: [newerPlay, olderPlay, olderPlay] });
		});
		vi.stubGlobal("fetch", fetcher);

		await expect(runScheduled(environment(database))).resolves.toEqual({ received: 3, accepted: 2 });
		expect(database.albums).toEqual(new Set(["album-1"]));
		expect(database.artists).toEqual(new Set(["artist-1", "artist-2"]));
		expect(database.tracks).toEqual(new Set(["track-1"]));
		expect(database.trackArtists).toEqual(new Set([
			"track-1\u0000artist-1",
			"track-1\u0000artist-2",
		]));
		expect(database.plays).toHaveLength(2);

		const newestTimestamp = Date.parse(newerPlay.played_at);
		expect(database.ingestionState.get(CURSOR_KEY)).toBe(String(newestTimestamp));
		expect(recentlyPlayedUrls[0].searchParams.has("after")).toBe(false);

		await expect(runScheduled(environment(database))).resolves.toEqual({ received: 3, accepted: 2 });
		expect(database.plays).toHaveLength(2);
		expect(database.batchCalls).toBe(2);
		expect(recentlyPlayedUrls[1].searchParams.get("after")).toBe(String(newestTimestamp));
		expect(fetcher).toHaveBeenCalledTimes(4);
	});

	it("preserves an existing cursor when Spotify returns no recent plays", async () => {
		const database = new TestDatabase();
		database.ingestionState.set(CURSOR_KEY, "1788177000000");
		let recentlyPlayedUrl: URL | undefined;
		vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
			const url = new URL(String(input));
			if (url.hostname === "accounts.spotify.com") {
				return Response.json({ access_token: "access-token" });
			}

			recentlyPlayedUrl = url;
			return Response.json({ items: [] });
		}));

		await expect(runScheduled(environment(database))).resolves.toEqual({ received: 0, accepted: 0 });
		expect(database.batchCalls).toBe(0);
		expect(database.ingestionState.get(CURSOR_KEY)).toBe("1788177000000");
		expect(recentlyPlayedUrl?.searchParams.get("after")).toBe("1788177000000");
	});
});
