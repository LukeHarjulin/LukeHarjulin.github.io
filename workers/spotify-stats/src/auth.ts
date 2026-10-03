import { cachedRouteRequest } from "./cache";
import { configuredOrigin, failure, options, success, validateCors } from "./http";
import type { Env, ExecutionContextLike } from "./runtime";

const encoder = new TextEncoder();
const lifetime = 7 * 24 * 60 * 60;
const cookieName = "__Host-listening_session";

function loopback(url: URL): boolean {
	return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

function localCookies(request: Request, env: Env): boolean {
	const url = new URL(request.url);
	return env.LISTENING_LOCAL_HTTP === "true" && url.protocol === "http:" && loopback(url)
		&& !!env.PUBLIC_SITE_ORIGIN && loopback(new URL(env.PUBLIC_SITE_ORIGIN));
}

function cookie(request: Request, env: Env, value: string, age = lifetime): string {
	const local = localCookies(request, env);
	return `${local ? "listening_session_local" : cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${local ? "" : "; Secure"}`;
}

async function signingKey(env: Env): Promise<CryptoKey> {
	const material = encoder.encode(JSON.stringify(["listening-session-v1", env.LISTENING_SESSION_SECRET, env.LISTENING_PASSPHRASE]));
	return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", material),
		{ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function encode(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decode(value: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
}

async function sessionExpiry(request: Request, env: Env, key: CryptoKey): Promise<number | null> {
	const name = localCookies(request, env) ? "listening_session_local" : cookieName;
	const matches = (request.headers.get("Cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
	if (matches.length !== 1) return null;
	const token = matches[0].slice(name.length + 1);
	if (token.length > 512) return null;
	try {
		const [payload, signature, extra] = token.split(".");
		if (!payload || !signature || extra !== undefined) return null;
		if (!await crypto.subtle.verify("HMAC", key, decode(signature), encoder.encode(payload))) return null;
		const data = JSON.parse(new TextDecoder().decode(decode(payload)));
		const now = Math.floor(Date.now() / 1000);
		return data.v === 1 && Number.isSafeInteger(data.iat) && Number.isSafeInteger(data.exp)
			&& data.iat <= now && data.iat >= 0 && data.exp - data.iat === lifetime && data.exp > now ? data.exp : null;
	} catch { return null; }
}

async function readLogin(request: Request): Promise<unknown> {
	if (Number(request.headers.get("Content-Length")) > 4096) throw new Error("Invalid request");
	const reader = request.body?.getReader();
	if (!reader) throw new Error("Invalid request");
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > 4096) { await reader.cancel(); throw new Error("Invalid request"); }
			chunks.push(value);
		}
	} finally { reader.releaseLock(); }
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function routeAuthenticated(request: Request, env: Env, context: ExecutionContextLike): Promise<Response> {
	const rejection = validateCors(request, env);
	if (rejection) return failure(rejection.code, rejection.message, request, env, rejection.status);
	if (request.method === "OPTIONS") return options(request, env);
	const url = new URL(request.url);
	if (!env.LISTENING_PASSPHRASE || env.LISTENING_PASSPHRASE.length < 12
		|| !env.LISTENING_SESSION_SECRET || env.LISTENING_SESSION_SECRET.length < 32
		|| !configuredOrigin(env) || !env.LOGIN_RATE_LIMITER
		|| (url.protocol !== "https:" && !localCookies(request, env))) {
		return failure("SERVICE_UNAVAILABLE", "Listening access is not configured", request, env, 503);
	}
	const path = url.pathname;
	if (path === "/api/auth/login" || path === "/api/auth/logout") {
		if (request.method !== "POST") return failure("METHOD_NOT_ALLOWED", "Method not allowed", request, env, 405);
		if (request.headers.get("Origin") !== env.PUBLIC_SITE_ORIGIN) return failure("CORS_ORIGIN_DENIED", "This origin is not allowed", request, env, 403);
		if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
			return failure("INVALID_REQUEST", "A JSON request is required", request, env, 415);
		}
		if (path === "/api/auth/logout") {
			const response = success({ authenticated: false }, request, env);
			response.headers.set("Set-Cookie", cookie(request, env, "", 0));
			return response;
		}
		const ip = request.headers.get("CF-Connecting-IP") ?? (localCookies(request, env) ? "local" : "unknown");
		if (!(await env.LOGIN_RATE_LIMITER.limit({ key: `login:${ip}` })).success) {
			const response = failure("TOO_MANY_ATTEMPTS", "Too many attempts. Try again in one minute.", request, env, 429);
			response.headers.set("Retry-After", "60");
			return response;
		}
		let input: unknown;
		try { input = await readLogin(request); }
		catch { return failure("INVALID_REQUEST", "Invalid login request", request, env, 400); }
		if (!input || typeof input !== "object" || !("passphrase" in input) || typeof input.passphrase !== "string") {
			return failure("INVALID_REQUEST", "A passphrase is required", request, env, 400);
		}
		const key = await signingKey(env);
		const expected = await crypto.subtle.digest("SHA-256", encoder.encode(env.LISTENING_PASSPHRASE));
		const supplied = await crypto.subtle.digest("SHA-256", encoder.encode(input.passphrase));
		// Web Crypto verifies the MAC of fixed-length digests without a JS string comparison.
		const expectedMac = await crypto.subtle.sign("HMAC", key, expected);
		if (!await crypto.subtle.verify("HMAC", key, expectedMac, supplied)) {
			return failure("INVALID_PASSPHRASE", "Incorrect passphrase", request, env, 401);
		}
		const iat = Math.floor(Date.now() / 1000);
		const payload = encode(encoder.encode(JSON.stringify({ v: 1, iat, exp: iat + lifetime })));
		const signature = encode(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
		const response = success({ authenticated: true, expiresAt: (iat + lifetime) * 1000 }, request, env);
		response.headers.set("Set-Cookie", cookie(request, env, `${payload}.${signature}`));
		return response;
	}
	const expires = await sessionExpiry(request, env, await signingKey(env));
	if (path === "/api/auth/session") {
		if (request.method !== "GET") return failure("METHOD_NOT_ALLOWED", "Method not allowed", request, env, 405);
		return success({ authenticated: expires !== null, expiresAt: expires === null ? null : expires * 1000 }, request, env);
	}
	if (!expires) return failure("UNAUTHENTICATED", "Enter the passphrase to view listening data", request, env, 401);
	// Only the authenticated path can access this internal shared cache. Never cache credentials.
	const headers = new Headers(request.headers);
	headers.delete("Cookie");
	headers.delete("Authorization");
	return cachedRouteRequest(new Request(request, { headers }), env, context);
}

export async function handleListeningRequest(request: Request, env: Env, context: ExecutionContextLike): Promise<Response> {
	let response: Response;
	try { response = await routeAuthenticated(request, env, context); }
	catch { response = failure("SERVICE_UNAVAILABLE", "Listening service is temporarily unavailable", request, env, 503); }
	// Internal cache responses have their own TTL; no authenticated data may enter a browser/CDN cache.
	const outgoing = new Response(response.body, response);
	outgoing.headers.set("Cache-Control", "private, no-store");
	outgoing.headers.set("CDN-Cache-Control", "no-store");
	return outgoing;
}
