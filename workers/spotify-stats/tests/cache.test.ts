import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedRouteRequest } from "../src/cache";
import type { D1PreparedStatement, Env } from "../src/runtime";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function harness() {
	const first = vi.fn(async () => ({ plays: 42 }));
	const statement = {
		bind() { return this; }, first,
		all: async () => ({ success: true, results: [] }),
		run: async () => ({ success: true }),
	} as D1PreparedStatement;
	const env: Env = {
		DB: { prepare: vi.fn(() => statement), batch: async () => [] },
		SPOTIFY_CLIENT_ID: "test", SPOTIFY_CLIENT_SECRET: "test", SPOTIFY_REFRESH_TOKEN: "test",
		PUBLIC_SITE_ORIGIN: "https://www.example.com",
	};
	const stored = new Map<string, { response: Response; expires: number }>();
	const key = (request: RequestInfo | URL) => request instanceof Request ? request.url : String(request);
	const cache = {
		match: vi.fn(async (request: RequestInfo | URL) => {
			const entry = stored.get(key(request));
			return entry && entry.expires > Date.now() ? entry.response.clone() : undefined;
		}),
		put: vi.fn(async (request: RequestInfo | URL, response: Response) => {
			const seconds = Number(response.headers.get("Cache-Control")?.match(/s-maxage=(\d+)/)?.[1]);
			stored.set(key(request), { response: response.clone(), expires: Date.now() + seconds * 1000 });
		}),
	};
	const storage = { open: vi.fn(async () => cache) };
	const pending: Promise<unknown>[] = [];
	const context = { waitUntil(promise: Promise<unknown>) { pending.push(promise); } };
	async function fetch(path: string, origin: string | null = env.PUBLIC_SITE_ORIGIN!, method = "GET") {
		const response = await cachedRouteRequest(new Request(`https://api.example.com${path}`, {
			method, headers: origin ? { Origin: origin } : {},
		}), env, context, storage);
		await Promise.all(pending.splice(0));
		return response;
	}
	return { fetch, env, first, cache, storage };
}

describe("public statistics cache", () => {
	it("shares normalized requests, avoids D1 on hits, and refreshes after expiry", async () => {
		vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-14T12:00:00Z"));
		const h = harness();
		const first = await h.fetch("/api/spotify/summary");
		expect(first.headers.get("X-Spotify-Cache")).toBe("MISS");
		const body = await first.json();
		const hit = await h.fetch("/api/spotify/summary?period=month&tracking=ignored");
		expect(hit.headers.get("X-Spotify-Cache")).toBe("HIT");
		expect(await hit.json()).toEqual(body);
		expect(h.first).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(601000);
		expect((await h.fetch("/api/spotify/summary")).headers.get("X-Spotify-Cache")).toBe("MISS");
		expect(h.first).toHaveBeenCalledTimes(2);
	});

	it("separates period/limit variants and rolls over at London midnight", async () => {
		vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-14T22:59:59Z"));
		const h = harness();
		await h.fetch("/api/spotify/summary?period=today");
		await h.fetch("/api/spotify/summary?period=all");
		expect(h.first).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(2000);
		expect((await h.fetch("/api/spotify/summary?period=today")).headers.get("X-Spotify-Cache")).toBe("MISS");
		await h.fetch("/api/spotify/recent?limit=01");
		expect((await h.fetch("/api/spotify/recent?limit=1")).headers.get("X-Spotify-Cache")).toBe("HIT");
		expect((await h.fetch("/api/spotify/recent?limit=2")).headers.get("X-Spotify-Cache")).toBe("MISS");
	});

	it("checks CORS before hits and separates originless response headers", async () => {
		const h = harness();
		await h.fetch("/api/spotify/lifetime", null);
		const allowed = await h.fetch("/api/spotify/lifetime");
		expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(h.env.PUBLIC_SITE_ORIGIN);
		expect((await h.fetch("/api/spotify/lifetime", "https://untrusted.example")).status).toBe(403);
		expect(h.first).toHaveBeenCalledTimes(2);
		expect((await h.fetch("/api/spotify/lifetime", null)).headers.has("Access-Control-Allow-Origin")).toBe(false);
	});

	it("does not cache errors, invalid input, OPTIONS, or archive searches", async () => {
		const h = harness();
		vi.spyOn(console, "error").mockImplementation(() => {});
		h.first.mockRejectedValueOnce(new Error("database unavailable"));
		expect((await h.fetch("/api/spotify/lifetime")).status).toBe(503);
		expect(h.cache.put).not.toHaveBeenCalled();
		expect((await h.fetch("/api/spotify/summary?period=invalid")).status).toBe(400);
		await h.fetch("/api/spotify/lifetime", h.env.PUBLIC_SITE_ORIGIN, "OPTIONS");
		await h.fetch("/api/spotify/archive/search?q=track");
		expect(h.cache.put).not.toHaveBeenCalled();
		expect((await h.fetch("/api/spotify/lifetime")).status).toBe(200);
		expect(h.cache.put).toHaveBeenCalledTimes(1);
	});

	it("serves the API response if cache reads or writes fail", async () => {
		const h = harness();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		h.cache.match.mockRejectedValueOnce(new Error("cache read failed"));
		h.cache.put.mockRejectedValueOnce(new Error("cache write failed"));
		expect((await h.fetch("/api/spotify/lifetime")).status).toBe(200);
		expect(console.warn).toHaveBeenCalledTimes(2);
	});
});
