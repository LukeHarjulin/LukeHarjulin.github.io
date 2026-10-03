import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/runtime";

const origin = "https://www.example.com";
const phrase = "a private listening phrase";
let env: Env;
let pending: Promise<unknown>[];
let stored: Map<string, Response>;
let cache: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
const context = { waitUntil(promise: Promise<unknown>) { pending.push(promise); } };

beforeEach(() => {
	pending = [];
	stored = new Map();
	cache = {
		match: vi.fn(async (request: Request) => stored.get(request.url)?.clone()),
		put: vi.fn(async (request: Request, response: Response) => { stored.set(request.url, response.clone()); }),
	};
	vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
	const statement = { bind() { return this; }, first: async () => ({ plays: 42 }), all: async () => ({ success: true, results: [] }), run: async () => ({ success: true }) };
	env = {
		DB: { prepare: vi.fn(() => statement), batch: vi.fn(async () => []) },
		SPOTIFY_CLIENT_ID: "test", SPOTIFY_CLIENT_SECRET: "test", SPOTIFY_REFRESH_TOKEN: "test",
		PUBLIC_SITE_ORIGIN: origin, LISTENING_PASSPHRASE: phrase,
		LISTENING_SESSION_SECRET: "test-session-secret-at-least-32-characters",
		LOGIN_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
	};
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function request(path: string, init: RequestInit = {}, host = "https://api.example.com") {
	const response = await worker.fetch(new Request(host + path, {
		...init, headers: { Origin: origin, ...init.headers },
	}), env, context);
	await Promise.all(pending.splice(0));
	return response;
}
function login(passphrase = phrase, headers: Record<string, string> = {}) {
	return request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ passphrase }) });
}
async function sessionCookie() {
	const response = await login();
	expect(response.status).toBe(200);
	return response.headers.get("Set-Cookie")!.split(";")[0];
}

describe("listening authentication boundary", () => {
	it("issues a seven-day host-only secure cookie and never returns a token in JSON", async () => {
		const response = await login();
		const cookie = response.headers.get("Set-Cookie")!;
		expect(cookie).toMatch(/^__Host-listening_session=/);
		for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=604800"]) expect(cookie).toContain(flag);
		expect(cookie).not.toContain("Domain=");
		const body = await response.json();
		expect(body.data).toEqual({ authenticated: true, expiresAt: expect.any(Number) });
		expect(JSON.stringify(body)).not.toContain(phrase);
		const session = await request("/api/auth/session", { headers: { Cookie: cookie.split(";")[0] } });
		expect((await session.json()).data).toEqual(body.data);
		expect(session.headers.has("Set-Cookie")).toBe(false);
	});

	it("rejects every data endpoint before cache, database, or upstream access", async () => {
		const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
		for (const path of ["now-playing", "summary", "top-artists", "top-tracks", "activity", "recent", "lifetime", "archive/search?q=test", "recommendations"]) {
			const response = await request(`/api/spotify/${path}`);
			expect(response.status).toBe(401);
			expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		}
		expect(cache.match).not.toHaveBeenCalled();
		expect(env.DB.prepare).not.toHaveBeenCalled();
		expect(upstream).not.toHaveBeenCalled();
	});

	it("authenticates before warm cache hits and keeps credentials out of cache keys and entries", async () => {
		const cookie = await sessionCookie();
		const first = await request("/api/spotify/summary", { headers: { Cookie: cookie } });
		expect(first.headers.get("X-Spotify-Cache")).toBe("MISS");
		expect(env.DB.prepare).toHaveBeenCalled();
		vi.mocked(env.DB.prepare).mockClear();
		const hit = await request("/api/spotify/summary", { headers: { Cookie: cookie } });
		expect(hit.headers.get("X-Spotify-Cache")).toBe("HIT");
		expect(hit.headers.get("Cache-Control")).toBe("private, no-store");
		expect(hit.headers.get("CDN-Cache-Control")).toBe("no-store");
		expect(env.DB.prepare).not.toHaveBeenCalled();
		expect((await request("/api/spotify/summary")).status).toBe(401);
		for (const [cacheRequest, response] of cache.put.mock.calls) {
			expect(cacheRequest.headers.has("Cookie")).toBe(false);
			expect(cacheRequest.headers.has("Authorization")).toBe(false);
			expect(cacheRequest.url).not.toContain(cookie);
			expect(response.headers.has("Set-Cookie")).toBe(false);
			expect(response.headers.get("Cache-Control")).toContain("s-maxage=");
		}
	});

	it("rejects tampering, malformed cookies, duplicates, expiry, and either secret rotation", async () => {
		vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
		const cookie = await sessionCookie();
		for (const bad of [cookie + "broken", "__Host-listening_session=invalid", cookie + "; " + cookie]) {
			expect((await request("/api/spotify/recent", { headers: { Cookie: bad } })).status).toBe(401);
		}
		env.LISTENING_PASSPHRASE = phrase + " changed";
		expect((await request("/api/spotify/recent", { headers: { Cookie: cookie } })).status).toBe(401);
		env.LISTENING_PASSPHRASE = phrase;
		env.LISTENING_SESSION_SECRET += " changed";
		expect((await request("/api/spotify/recent", { headers: { Cookie: cookie } })).status).toBe(401);
		const fresh = await sessionCookie();
		vi.advanceTimersByTime(604800000);
		expect((await request("/api/spotify/recent", { headers: { Cookie: fresh } })).status).toBe(401);
		expect((await (await request("/api/auth/session", { headers: { Cookie: fresh } })).json()).data.authenticated).toBe(false);
	});

	it("limits login attempts and fails closed when configuration or limiter fails", async () => {
		expect((await login("wrong passphrase")).status).toBe(401);
		vi.mocked(env.LOGIN_RATE_LIMITER!.limit).mockResolvedValueOnce({ success: false });
		const limited = await login();
		expect(limited.status).toBe(429);
		expect(limited.headers.get("Retry-After")).toBe("60");
		vi.mocked(env.LOGIN_RATE_LIMITER!.limit).mockRejectedValueOnce(new Error("private upstream details"));
		const unavailable = await login();
		expect(unavailable.status).toBe(503);
		expect(await unavailable.text()).not.toContain("private upstream details");
		for (const name of ["LISTENING_PASSPHRASE", "LISTENING_SESSION_SECRET", "LOGIN_RATE_LIMITER", "PUBLIC_SITE_ORIGIN"] as const) {
			const original = env[name]; delete env[name];
			expect((await login()).status).toBe(503);
			Object.assign(env, { [name]: original });
		}
		env.PUBLIC_SITE_ORIGIN = "not a valid origin";
		expect((await worker.fetch(new Request("https://api.example.com/api/auth/session"), env, context)).status).toBe(503);
	});

	it("enforces exact origins and JSON on mutations, while allowing preflight", async () => {
		for (const path of ["login", "logout"]) {
			for (const badOrigin of ["https://attacker.example", "null", ""]) {
				expect((await request(`/api/auth/${path}`, { method: "POST", headers: { Origin: badOrigin, "Content-Type": "application/json" }, body: "{}" })).status).toBe(403);
			}
			expect((await request(`/api/auth/${path}`, { method: "POST", body: "{}" })).status).toBe(415);
			expect((await request(`/api/auth/${path}`)).status).toBe(405);
		}
		const preflight = await request("/api/auth/login", { method: "OPTIONS" });
		expect(preflight.status).toBe(200);
		expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(origin);
		expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBe("true");
		expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain("POST");
	});

	it("rejects malformed and oversized input including streamed bodies", async () => {
		for (const body of ["{", "null", "{}", '{"passphrase":42}', JSON.stringify({ passphrase: "x".repeat(4096) })]) {
			expect((await request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body })).status).toBe(400);
		}
		const cancel = vi.fn();
		const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel });
		const streamed = new Request("https://api.example.com/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
		expect((await worker.fetch(streamed, env, context)).status).toBe(400);
		expect(cancel).toHaveBeenCalled();
	});

	it("expires the cookie on logout and limits insecure development cookies to loopback", async () => {
		const logout = await request("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
		expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
		env.LISTENING_LOCAL_HTTP = "true";
		env.PUBLIC_SITE_ORIGIN = "http://127.0.0.1:8000";
		const init = { method: "POST", headers: { Origin: env.PUBLIC_SITE_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ passphrase: phrase }) };
		const local = await request("/api/auth/login", init, "http://127.0.0.1:8787");
		expect(local.status).toBe(200);
		expect(local.headers.get("Set-Cookie")).toMatch(/^listening_session_local=/);
		expect(local.headers.get("Set-Cookie")).not.toContain("Secure");
		expect((await request("/api/auth/login", init, "http://api.example.com")).status).toBe(503);
		expect((await request("/api/auth/login", init)).headers.get("Set-Cookie")).toContain("Secure");
	});
});
