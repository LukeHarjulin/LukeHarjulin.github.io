import type { Env } from "./runtime";
import type {
	PublicTrack,
	SpotifyCurrentlyPlayingResponse,
	SpotifyRecentlyPlayedResponse,
	SpotifyTrack,
} from "./types";

const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const API_BASE_URL = "https://api.spotify.com/v1";

export class SpotifyApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly retryAfter: string | null = null,
	) {
		super(message);
		this.name = "SpotifyApiError";
	}
}

export function toPublicTrack(track: SpotifyTrack): PublicTrack {
	return {
		id: track.id,
		name: track.name,
		artists: track.artists.map((artist) => ({ id: artist.id, name: artist.name })),
		album: {
			id: track.album.id,
			name: track.album.name,
			artworkUrl: track.album.images?.[0]?.url ?? null,
		},
		durationMs: track.duration_ms,
		spotifyUrl: track.external_urls?.spotify ?? null,
	};
}

async function getAccessToken(env: Env, fetcher: typeof fetch): Promise<string> {
	const credentials = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
	const response = await fetcher(TOKEN_ENDPOINT, {
		method: "POST",
		headers: {
			Authorization: `Basic ${credentials}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: env.SPOTIFY_REFRESH_TOKEN,
		}),
	});

	if (!response.ok) {
		throw new SpotifyApiError("Spotify token refresh failed", response.status);
	}

	const payload = await response.json() as { access_token?: string };
	if (!payload.access_token) {
		throw new SpotifyApiError("Spotify token response did not contain an access token", 502);
	}

	return payload.access_token;
}

async function spotifyFetch(
	env: Env,
	path: string,
	init: RequestInit = {},
	fetcher: typeof fetch = fetch,
): Promise<Response> {
	const accessToken = await getAccessToken(env, fetcher);
	const response = await fetcher(`${API_BASE_URL}${path}`, {
		...init,
		headers: {
			...init.headers,
			Authorization: `Bearer ${accessToken}`,
		},
	});

	if (!response.ok && response.status !== 204) {
		throw new SpotifyApiError(
			"Spotify API request failed",
			response.status,
			response.headers.get("Retry-After"),
		);
	}

	return response;
}

export async function getCurrentlyPlaying(
	env: Env,
	fetcher: typeof fetch = fetch,
): Promise<SpotifyCurrentlyPlayingResponse | null> {
	const response = await spotifyFetch(env, "/me/player/currently-playing", {}, fetcher);
	if (response.status === 204) {
		return null;
	}

	const payload = await response.json() as SpotifyCurrentlyPlayingResponse;
	return payload.item ? payload : null;
}

export async function getRecentlyPlayed(
	env: Env,
	after: number | null,
	fetcher: typeof fetch = fetch,
): Promise<SpotifyRecentlyPlayedResponse> {
	const params = new URLSearchParams({ limit: "50" });
	if (after !== null) {
		params.set("after", String(after));
	}

	const response = await spotifyFetch(env, `/me/player/recently-played?${params}`, {}, fetcher);
	return response.json() as Promise<SpotifyRecentlyPlayedResponse>;
}
