import { afterEach, describe, expect, it, vi } from "vitest";
import type { D1Database, D1PreparedStatement, Env } from "../src/runtime";
import { routeRequest } from "../src/router";

interface DatabaseOptions {
	first?: unknown;
	all?: unknown[];
	onBind?: (values: unknown[]) => void;
}

function mockDatabase(options: DatabaseOptions = {}): D1Database {
	const statement: D1PreparedStatement = {
		bind(...values: unknown[]) {
			options.onBind?.(values);
			return statement;
		},
		async first<T>() {
			return (options.first ?? null) as T | null;
		},
		async all<T>() {
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

function environment(db = mockDatabase(), origin: string | null = "https://www.example.com"): Env {
	const env: Env = {
		DB: db,
		SPOTIFY_CLIENT_ID: "client-id",
		SPOTIFY_CLIENT_SECRET: "client-secret",
		SPOTIFY_REFRESH_TOKEN: "refresh-token",
	};
	if (origin !== null) env.PUBLIC_SITE_ORIGIN = origin;
	return env;
}

function request(path: string, origin: string | null = "https://www.example.com", init?: RequestInit) {
	const headers = new Headers(init?.headers);
	if (origin) headers.set("Origin", origin);
	return new Request(`https://worker.example${path}`, { ...init, headers });
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("response envelopes", () => {
	it("wraps aggregate successes with generatedAt and period metadata", async () => {
		const totals = { plays: 3, listeningTimeMs: 540000, uniqueArtists: 2, uniqueTracks: 3 };
		const response = await routeRequest(
			request("/api/spotify/summary?period=today"),
			environment(mockDatabase({ first: totals })),
		);
		const body = await response.json() as Record<string, any>;

		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
		expect(body.data).toEqual({ totals });
		expect(body.meta.period).toBe("today");
		expect(Date.parse(body.meta.generatedAt)).not.toBeNaN();
	});

	it("uses structured error codes", async () => {
		const response = await routeRequest(
			request("/api/spotify/archive/search?q=x"),
			environment(),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: "INVALID_QUERY",
				message: "Query must be 2-100 characters",
			},
		});
	});

	it("returns a named not-found error without exposing ingestion", async () => {
		const response = await routeRequest(request("/api/spotify/ingest"), environment());
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: { code: "NOT_FOUND", message: "Not found" },
		});
	});
});

describe("CORS", () => {
	it("wraps an allowed preflight response in the success envelope", async () => {
		const response = await routeRequest(request("/api/spotify/recent", "https://www.example.com", {
			method: "OPTIONS",
		}), environment());
		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://www.example.com");
		expect(await response.json()).toMatchObject({
			data: null,
			meta: { generatedAt: expect.any(String) },
		});
	});

	it("allows the configured portfolio origin", async () => {
		const response = await routeRequest(request("/missing"), environment());
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://www.example.com");
		expect(response.headers.get("Vary")).toBe("Origin");
	});

	it("rejects a different browser origin without an allow-origin header", async () => {
		const response = await routeRequest(
			request("/api/spotify/recent", "https://attacker.example"),
			environment(),
		);
		expect(response.status).toBe(403);
		expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
		expect(await response.json()).toEqual({
			error: { code: "CORS_ORIGIN_DENIED", message: "This origin is not allowed" },
		});
	});

	it.each([
		["missing", null],
		["invalid", "https://www.example.com/path"],
	])("fails closed with SERVICE_UNAVAILABLE when the configured origin is %s", async (_case, origin) => {
		const response = await routeRequest(request("/api/spotify/recent"), environment(mockDatabase(), origin));
		expect(response.status).toBe(503);
		expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
		expect(await response.json()).toEqual({
			error: { code: "SERVICE_UNAVAILABLE", message: "Service unavailable" },
		});
	});

	it("allows origin-less requests without emitting a wildcard", async () => {
		const response = await routeRequest(request("/missing", null), environment(mockDatabase(), null));
		expect(response.status).toBe(404);
		expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
	});
});

describe("cache and limits", () => {
	it("uses 365 inclusive London dates only for activity and preserves calendar reporting elsewhere", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-30T00:30:00.000Z"));
		const activityBindings: unknown[][] = [];
		const rankingBindings: unknown[][] = [];
		const archiveBindings: unknown[][] = [];

		const activityResponse = await routeRequest(
			request("/api/spotify/activity"),
			environment(mockDatabase({ all: [], onBind: (values) => activityBindings.push(values) })),
		);
		await routeRequest(
			request("/api/spotify/top-artists?period=year"),
			environment(mockDatabase({ all: [], onBind: (values) => rankingBindings.push(values) })),
		);
		await routeRequest(
			request("/api/spotify/archive/search?q=test"),
			environment(mockDatabase({ all: [], onBind: (values) => archiveBindings.push(values) })),
		);

		expect(activityBindings).toEqual([["2025-03-30T23:00:00.000Z"]]);
		expect(rankingBindings).toEqual([["2026-01-01T00:00:00.000Z", 10]]);
		expect(archiveBindings).toEqual([[
			"2026-01-01T00:00:00.000Z",
			"2026-03-01T00:00:00.000Z",
			"%test%",
			20,
		]]);
		expect(await activityResponse.json()).toMatchObject({
			data: { days: [] },
			meta: { period: "year", generatedAt: "2026-03-30T00:30:00.000Z" },
		});
	});

	it("uses the recent default of 20, caps at 50, and caches for 30 seconds", async () => {
		const bindings: unknown[][] = [];
		const db = mockDatabase({ all: [], onBind: (values) => bindings.push(values) });
		const defaultResponse = await routeRequest(request("/api/spotify/recent"), environment(db));
		const maximumResponse = await routeRequest(request("/api/spotify/recent?limit=50"), environment(db));
		const overLimitResponse = await routeRequest(request("/api/spotify/recent?limit=51"), environment(db));

		expect(bindings).toEqual([[20], [50]]);
		expect(defaultResponse.headers.get("Cache-Control")).toBe("public, max-age=30");
		expect(maximumResponse.status).toBe(200);
		expect(overLimitResponse.status).toBe(400);
		expect(await overLimitResponse.json()).toEqual({
			error: { code: "INVALID_LIMIT", message: "Invalid limit" },
		});
	});

	it("caches now-playing responses for 15 seconds", async () => {
		const fetcher = vi.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ access_token: "access-token" }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetcher);

		const response = await routeRequest(request("/api/spotify/now-playing"), environment());
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=15");
		expect(await response.json()).toMatchObject({
			data: null,
			meta: { generatedAt: expect.any(String) },
		});
	});
});
