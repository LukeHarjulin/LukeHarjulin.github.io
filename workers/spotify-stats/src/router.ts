import { failure, options, success, validateCors } from "./http";
import {
	activityPeriodStart,
	parseActivityPeriod,
	parseLimit,
	parseRankingPeriod,
	parseSummaryPeriod,
	periodStart,
} from "./periods";
import {
	getActivity,
	getLifetimeTotals,
	getMostRecentPlay,
	getRecentPlays,
	getSummary,
	getTopArtists,
	getTopTracks,
	searchArchive,
} from "./repository";
import type { Env } from "./runtime";
import { getCurrentlyPlaying, SpotifyApiError, toPublicTrack } from "./spotify";

export async function routeRequest(request: Request, env: Env): Promise<Response> {
	const now = new Date();
	const corsRejection = validateCors(request, env);
	if (corsRejection) {
		return failure(corsRejection.code, corsRejection.message, request, env, corsRejection.status);
	}

	if (request.method === "OPTIONS") {
		return options(request, env);
	}

	if (request.method !== "GET") {
		return failure("METHOD_NOT_ALLOWED", "Method not allowed", request, env, 405);
	}

	const url = new URL(request.url);

	try {
		switch (url.pathname) {
			case "/api/spotify/now-playing": {
				const current = await getCurrentlyPlaying(env);
				if (current?.item) {
					return success({
						isPlaying: current.is_playing,
						progressMs: current.progress_ms,
						checkedAt: new Date(current.timestamp).toISOString(),
						track: toPublicTrack(current.item),
					}, request, env, { cacheSeconds: 15, generatedAt: now });
				}

				const recent = await getMostRecentPlay(env.DB);
				return success(recent ? {
					isPlaying: false,
					progressMs: null,
					checkedAt: now.toISOString(),
					playedAt: recent.playedAt,
					track: recent.track,
				} : null, request, env, { cacheSeconds: 15, generatedAt: now });
			}

			case "/api/spotify/summary": {
				const period = parseSummaryPeriod(url.searchParams.get("period"));
				if (!period) return failure("INVALID_PERIOD", "Invalid period", request, env, 400);
				return success(
					{ totals: await getSummary(env.DB, periodStart(period, now)) },
					request,
					env,
					{ period, generatedAt: now },
				);
			}

			case "/api/spotify/top-artists": {
				const period = parseRankingPeriod(url.searchParams.get("period"));
				const limit = parseLimit(url.searchParams.get("limit"), 10, 50);
				if (!period) return failure("INVALID_PERIOD", "Invalid period", request, env, 400);
				if (!limit) return failure("INVALID_LIMIT", "Invalid limit", request, env, 400);
				return success(
					{ artists: await getTopArtists(env.DB, periodStart(period, now), limit) },
					request,
					env,
					{ period, generatedAt: now },
				);
			}

			case "/api/spotify/top-tracks": {
				const period = parseRankingPeriod(url.searchParams.get("period"));
				const limit = parseLimit(url.searchParams.get("limit"), 10, 50);
				if (!period) return failure("INVALID_PERIOD", "Invalid period", request, env, 400);
				if (!limit) return failure("INVALID_LIMIT", "Invalid limit", request, env, 400);
				return success(
					{ tracks: await getTopTracks(env.DB, periodStart(period, now), limit) },
					request,
					env,
					{ period, generatedAt: now },
				);
			}

			case "/api/spotify/activity": {
				const period = parseActivityPeriod(url.searchParams.get("period"));
				if (!period) return failure("INVALID_PERIOD", "Invalid period", request, env, 400);
				return success(
					{ days: await getActivity(env.DB, activityPeriodStart(period, now)) },
					request,
					env,
					{ period, generatedAt: now },
				);
			}

			case "/api/spotify/archive/search": {
				const query = (url.searchParams.get("q") ?? "").trim();
				const limit = parseLimit(url.searchParams.get("limit"), 20, 50);
				if (query.length < 2 || query.length > 100) {
					return failure("INVALID_QUERY", "Query must be 2-100 characters", request, env, 400);
				}
				if (!limit) return failure("INVALID_LIMIT", "Invalid limit", request, env, 400);
				return success({
					query,
					tracks: await searchArchive(
						env.DB,
						query,
						limit,
						periodStart("year", now)!,
						periodStart("month", now)!,
					),
				}, request, env, { generatedAt: now });
			}

			case "/api/spotify/recent": {
				const limit = parseLimit(url.searchParams.get("limit"), 20, 50);
				if (!limit) return failure("INVALID_LIMIT", "Invalid limit", request, env, 400);
				return success(
					{ plays: await getRecentPlays(env.DB, limit) },
					request,
					env,
					{ cacheSeconds: 30, generatedAt: now },
				);
			}

			case "/api/spotify/lifetime":
				return success(
					{ totals: await getLifetimeTotals(env.DB) },
					request,
					env,
					{ generatedAt: now },
				);

			default:
				return failure("NOT_FOUND", "Not found", request, env, 404);
		}
	} catch (error) {
		if (error instanceof SpotifyApiError && error.status === 429) {
			const response = failure(
				"UPSTREAM_RATE_LIMITED",
				"Upstream service is rate limited",
				request,
				env,
				503,
			);
			if (error.retryAfter) response.headers.set("Retry-After", error.retryAfter);
			return response;
		}

		console.error("Spotify stats request failed", error);
		return failure("SERVICE_UNAVAILABLE", "Service unavailable", request, env, 503);
	}
}
