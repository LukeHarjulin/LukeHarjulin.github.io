import { validateCors } from "./http";
import {
	parseActivityPeriod, parseLimit, parseRankingPeriod, parseSummaryPeriod, reportingDate,
} from "./periods";
import { routeRequest } from "./router";
import type { Env, ExecutionContextLike } from "./runtime";

// Cache only the finite public statistics variants. Search remains uncached.
// Normalize parameters so tracking parameters and equivalent defaults cannot
// create an unbounded set of expensive cache misses.
function cachePolicy(request: Request, env: Env): { key: Request; seconds: number } | null {
	if (request.method !== "GET" || validateCors(request, env)
		|| request.headers.has("Authorization") || request.headers.has("Cookie")) return null;
	const source = new URL(request.url);
	const key = new URL(source.origin + source.pathname);
	let seconds = 600;
	let period: string | null;
	switch (source.pathname) {
		case "/api/spotify/summary":
			period = parseSummaryPeriod(source.searchParams.get("period"));
			if (!period) return null;
			key.searchParams.set("period", period);
			break;
		case "/api/spotify/top-artists":
		case "/api/spotify/top-tracks": {
			period = parseRankingPeriod(source.searchParams.get("period"));
			const limit = parseLimit(source.searchParams.get("limit"), 10, 50);
			if (!period || !limit) return null;
			key.searchParams.set("period", period);
			key.searchParams.set("limit", String(limit));
			break;
		}
		case "/api/spotify/activity":
			period = parseActivityPeriod(source.searchParams.get("period"));
			if (!period) return null;
			key.searchParams.set("period", period);
			break;
		case "/api/spotify/recent": {
			const limit = parseLimit(source.searchParams.get("limit"), 20, 50);
			if (!limit) return null;
			key.searchParams.set("limit", String(limit));
			seconds = 30;
			break;
		}
		case "/api/spotify/lifetime":
			seconds = 3600;
			break;
		case "/api/spotify/now-playing":
			seconds = 15;
			break;
		default:
			return null;
	}
	// Partition CORS variants and roll calendar statistics over at London midnight.
	key.searchParams.set("_origin", request.headers.get("Origin") ?? "");
	key.searchParams.set("_site", env.PUBLIC_SITE_ORIGIN ?? "");
	key.searchParams.set("_date", reportingDate(new Date()));
	return { key: new Request(key), seconds };
}

export async function cachedRouteRequest(
	request: Request,
	env: Env,
	context: ExecutionContextLike,
	storage: { open(name: string): Promise<Pick<Cache, "match" | "put">> } = caches,
): Promise<Response> {
	const policy = cachePolicy(request, env);
	if (!policy) return routeRequest(request, env);
	let cache: Pick<Cache, "match" | "put"> | undefined;
	try {
		cache = await storage.open("spotify-public-v1");
		const hit = await cache.match(policy.key);
		if (hit) {
			const response = new Response(hit.body, hit);
			response.headers.set("X-Spotify-Cache", "HIT");
			return response;
		}
	} catch (error) {
		console.warn("Spotify cache read failed", error);
	}
	const response = await routeRequest(request, env);
	if (response.status !== 200) return response;
	response.headers.set("X-Spotify-Cache", "MISS");
	response.headers.append("Cache-Control", `s-maxage=${policy.seconds}`);
	if (cache) {
		context.waitUntil(cache.put(policy.key, response.clone()).catch((error) => {
			console.warn("Spotify cache write failed", error);
		}));
	}
	return response;
}
