import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1Database, D1PreparedStatement, Env } from "../src/runtime";
import { routeRequest } from "../src/router";

const NOW = "2026-08-31T12:00:00.000Z";
const ALLOWED_ORIGIN = "https://www.example.com";

const trackRow = {
	id: "track-1",
	name: "Contract Track",
	durationMs: 180000,
	spotifyUrl: "https://open.spotify.com/track/track-1",
	albumId: "album-1",
	albumName: "Contract Album",
	artworkUrl: "https://images.example/album-1.jpg",
	artistsJson: JSON.stringify([{ id: "artist-1", name: "Contract Artist" }]),
};

const publicTrack = {
	id: "track-1",
	name: "Contract Track",
	artists: [{ id: "artist-1", name: "Contract Artist" }],
	album: {
		id: "album-1",
		name: "Contract Album",
		artworkUrl: "https://images.example/album-1.jpg",
	},
	durationMs: 180000,
	spotifyUrl: "https://open.spotify.com/track/track-1",
};

interface DatabaseOptions {
	first?: unknown;
	all?: unknown[];
	error?: Error;
}

function mockDatabase(options: DatabaseOptions = {}): D1Database {
	const statement: D1PreparedStatement = {
		bind() {
			return statement;
		},
		async first<T>() {
			if (options.error) throw options.error;
			return (options.first ?? null) as T | null;
		},
		async all<T>() {
			if (options.error) throw options.error;
			return { success: true, results: (options.all ?? []) as T[] };
		},
		async run<T>() {
			return { success: true, results: [] as T[] };
		},
	};

	return {
		prepare: () => statement,
		batch: async () => [],
	};
}

function environment(db = mockDatabase()): Env {
	return {
		DB: db,
		SPOTIFY_CLIENT_ID: "test-client-id",
		SPOTIFY_CLIENT_SECRET: "test-client-secret",
		SPOTIFY_REFRESH_TOKEN: "test-refresh-token",
		PUBLIC_SITE_ORIGIN: ALLOWED_ORIGIN,
	};
}

function request(path: string, init?: RequestInit): Request {
	const headers = new Headers(init?.headers);
	headers.set("Origin", ALLOWED_ORIGIN);
	return new Request(`https://worker.example${path}`, { ...init, headers });
}

async function expectSuccess(
	response: Response,
	data: unknown,
	meta: Record<string, unknown> = {},
): Promise<void> {
	expect(response.status).toBe(200);
	expect(response.headers.get("Content-Type")).toContain("application/json");
	expect(await response.json()).toEqual({
		data,
		meta: {
			generatedAt: NOW,
			...meta,
		},
	});
}

async function expectError(
	response: Response,
	status: number,
	code: string,
	message: string,
): Promise<void> {
	expect(response.status).toBe(status);
	expect(response.headers.get("Cache-Control")).toBe("no-store");
	expect(await response.json()).toEqual({ error: { code, message } });
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("public Spotify stats success response contracts", () => {
	it("returns the now-playing envelope", async () => {
		const fetcher = vi.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ access_token: "test-access-token" }))
			.mockResolvedValueOnce(Response.json({
				is_playing: true,
				progress_ms: 42000,
				timestamp: Date.parse(NOW),
				item: {
					id: trackRow.id,
					name: trackRow.name,
					duration_ms: trackRow.durationMs,
					artists: [{ id: "artist-1", name: "Contract Artist" }],
					album: {
						id: trackRow.albumId,
						name: trackRow.albumName,
						images: [{ url: trackRow.artworkUrl }],
					},
					external_urls: { spotify: trackRow.spotifyUrl },
				},
			}));
		vi.stubGlobal("fetch", fetcher);

		const response = await routeRequest(request("/api/spotify/now-playing"), environment());

		await expectSuccess(response, {
			isPlaying: true,
			progressMs: 42000,
			checkedAt: NOW,
			track: publicTrack,
		});
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=15");
	});

	it("returns the summary envelope with its period", async () => {
		const totals = {
			plays: 12,
			listeningTimeMs: 2160000,
			uniqueArtists: 4,
			uniqueTracks: 9,
		};
		const response = await routeRequest(
			request("/api/spotify/summary?period=month"),
			environment(mockDatabase({ first: totals })),
		);

		await expectSuccess(response, { totals }, { period: "month" });
	});

	it("returns the top-artists envelope with its period", async () => {
		const artists = [{
			id: "artist-1",
			name: "Contract Artist",
			spotifyUrl: "https://open.spotify.com/artist/artist-1",
			plays: 8,
			listeningTimeMs: 1440000,
		}];
		const response = await routeRequest(
			request("/api/spotify/top-artists?period=7d&limit=1"),
			environment(mockDatabase({ all: artists })),
		);

		await expectSuccess(response, { artists }, { period: "7d" });
	});

	it("returns the top-tracks envelope with normalized track metadata", async () => {
		const response = await routeRequest(
			request("/api/spotify/top-tracks?period=30d&limit=1"),
			environment(mockDatabase({
				all: [{ ...trackRow, plays: 5, listeningTimeMs: 900000 }],
			})),
		);

		await expectSuccess(response, {
			tracks: [{ track: publicTrack, plays: 5, listeningTimeMs: 900000 }],
		}, { period: "30d" });
	});

	it("returns the activity envelope with grouped daily totals", async () => {
		const response = await routeRequest(
			request("/api/spotify/activity?period=year"),
			environment(mockDatabase({
				all: [
					{ playedAt: "2026-08-30T10:00:00.000Z", durationMs: 120000 },
					{ playedAt: "2026-08-30T11:00:00.000Z", durationMs: 180000 },
				],
			})),
		);

		await expectSuccess(response, {
			days: [{ date: "2026-08-30", plays: 2, listeningTimeMs: 300000 }],
		}, { period: "year" });
	});

	it("returns the archive-search envelope with aggregate play fields", async () => {
		const response = await routeRequest(
			request("/api/spotify/archive/search?q=Contract&limit=1"),
			environment(mockDatabase({
				all: [{
					...trackRow,
					firstPlayed: "2025-01-02T10:00:00.000Z",
					lastPlayed: "2026-08-30T11:00:00.000Z",
					totalPlays: 14,
					playsThisYear: 9,
					playsThisMonth: 3,
					totalListeningTimeMs: 2520000,
				}],
			})),
		);

		await expectSuccess(response, {
			query: "Contract",
			tracks: [{
				track: publicTrack,
				firstPlayed: "2025-01-02T10:00:00.000Z",
				lastPlayed: "2026-08-30T11:00:00.000Z",
				totalPlays: 14,
				playsThisYear: 9,
				playsThisMonth: 3,
				totalListeningTimeMs: 2520000,
			}],
		});
	});

	it("returns the recent-plays envelope", async () => {
		const response = await routeRequest(
			request("/api/spotify/recent?limit=1"),
			environment(mockDatabase({
				all: [{ ...trackRow, playedAt: "2026-08-30T11:00:00.000Z" }],
			})),
		);

		await expectSuccess(response, {
			plays: [{ track: publicTrack, playedAt: "2026-08-30T11:00:00.000Z" }],
		});
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=30");
	});

	it("returns the lifetime-totals envelope", async () => {
		const totals = {
			plays: 120,
			listeningTimeMs: 21600000,
			uniqueArtists: 25,
			uniqueTracks: 80,
			firstPlayed: "2025-01-02T10:00:00.000Z",
			lastPlayed: "2026-08-30T11:00:00.000Z",
		};
		const response = await routeRequest(
			request("/api/spotify/lifetime"),
			environment(mockDatabase({ first: totals })),
		);

		await expectSuccess(response, { totals });
	});
});

describe("public Spotify stats error response contracts", () => {
	it.each([
		["/api/spotify/summary?period=weekly", "INVALID_PERIOD", "Invalid period"],
		["/api/spotify/top-artists?limit=0", "INVALID_LIMIT", "Invalid limit"],
		["/api/spotify/top-tracks?period=quarter", "INVALID_PERIOD", "Invalid period"],
		["/api/spotify/activity?period=7d", "INVALID_PERIOD", "Invalid period"],
		["/api/spotify/archive/search?q=x", "INVALID_QUERY", "Query must be 2-100 characters"],
		["/api/spotify/recent?limit=51", "INVALID_LIMIT", "Invalid limit"],
	])("returns a validation error for %s", async (path, code, message) => {
		await expectError(await routeRequest(request(path), environment()), 400, code, message);
	});

	it("rejects non-GET methods", async () => {
		const response = await routeRequest(
			request("/api/spotify/lifetime", { method: "POST" }),
			environment(),
		);

		await expectError(response, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
	});

	it("rejects disallowed browser origins", async () => {
		const response = await routeRequest(
			new Request("https://worker.example/api/spotify/recent", {
				headers: { Origin: "https://other.example" },
			}),
			environment(),
		);

		await expectError(response, 403, "CORS_ORIGIN_DENIED", "This origin is not allowed");
		expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
	});

	it("returns a not-found error for unsupported public paths", async () => {
		await expectError(
			await routeRequest(request("/api/spotify/plays"), environment()),
			404,
			"NOT_FOUND",
			"Not found",
		);
	});

	it("maps Spotify rate limits without leaking upstream response details", async () => {
		const fetcher = vi.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ access_token: "test-access-token" }))
			.mockResolvedValueOnce(new Response("upstream detail", {
				status: 429,
				headers: { "Retry-After": "30" },
			}));
		vi.stubGlobal("fetch", fetcher);

		const response = await routeRequest(request("/api/spotify/now-playing"), environment());

		await expectError(
			response,
			503,
			"UPSTREAM_RATE_LIMITED",
			"Upstream service is rate limited",
		);
		expect(response.headers.get("Retry-After")).toBe("30");
	});

	it("maps repository failures to the generic service-unavailable contract", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const response = await routeRequest(
			request("/api/spotify/lifetime"),
			environment(mockDatabase({ error: new Error("private database detail") })),
		);

		await expectError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
	});
});
