import { pauseCatalogue, reserveCatalogueRequest, retrySeconds } from "./catalogue-budget";
import { getAccessToken, SpotifyApiError } from "./spotify";
import type { Env } from "./runtime";

export function normalizeGenres(value: unknown): { key: string; name: string }[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("Invalid genre response");
	const unique = new Map<string, string>();
	for (const item of value) {
		const name = item.trim().replace(/\s+/g, " ");
		if (name && name.length <= 100) unique.set(name.toLowerCase(), name);
	}
	if (unique.size > 100) throw new Error("Invalid genre response");
	return [...unique].map(([key, name]) => ({ key, name }));
}

export async function enrichArtistGenres(env: Env, now = new Date(), fetcher: typeof fetch = fetch): Promise<void> {
	if (env.GENRE_ENRICHMENT_ENABLED !== "true") return;
	const day = now.toISOString().slice(0, 10);
	// Persist an hourly lease before scanning or fetching; duplicate Cron runs stop here.
	const lease = await env.DB.prepare(`UPDATE spotify_catalogue_state SET genre_lease_until_ms = ?
		WHERE id = 1 AND genre_lease_until_ms <= ? AND retry_after_ms <= ?
			AND (day <> ? OR (genre_requests < 12 AND requests < 40))
		RETURNING genre_priority_date`)
		.bind(now.getTime() + 3600000, now.getTime(), now.getTime(), day).first<{ genre_priority_date: string }>();
	if (!lease) return;
	if (lease.genre_priority_date !== day) {
		// At most one full archive scan per UTC day; cache only 100 pending candidates.
		await env.DB.batch([
			env.DB.prepare("DELETE FROM artist_genre_priority"),
			env.DB.prepare(`INSERT INTO artist_genre_priority(spotify_artist_id, listening_time_ms)
				SELECT a.spotify_artist_id, SUM(COALESCE(p.listened_ms, t.duration_ms))
				FROM plays p JOIN tracks t ON t.spotify_track_id = p.spotify_track_id
				JOIN reporting_track_artists ra ON ra.spotify_track_id = t.spotify_track_id AND ra.artist_order = 0
				JOIN artists a ON a.spotify_artist_id = ra.artist_id
				WHERE a.genres_checked_at IS NULL AND a.genres_retry_after_ms <= ?
					AND length(a.spotify_artist_id) = 22 AND a.spotify_artist_id NOT GLOB '*[^a-zA-Z0-9]*'
				GROUP BY a.spotify_artist_id HAVING SUM(COALESCE(p.listened_ms, t.duration_ms)) > 0
				ORDER BY SUM(COALESCE(p.listened_ms, t.duration_ms)) DESC, a.spotify_artist_id LIMIT 100`).bind(now.getTime()),
			env.DB.prepare("UPDATE spotify_catalogue_state SET genre_priority_date = ? WHERE id = 1").bind(day),
		]);
	}
	const artist = await env.DB.prepare(`SELECT a.spotify_artist_id AS id
		FROM artist_genre_priority q JOIN artists a ON a.spotify_artist_id = q.spotify_artist_id
		WHERE a.genres_checked_at IS NULL AND a.genres_retry_after_ms <= ?
		ORDER BY q.listening_time_ms DESC, a.spotify_artist_id LIMIT 1`).bind(now.getTime()).first<{ id: string }>();
	if (!artist || !await reserveCatalogueRequest(env.DB, true, now)) return;
	try {
		const token = await getAccessToken(env, fetcher);
		const response = await fetcher.call(globalThis, `https://api.spotify.com/v1/artists/${artist.id}`, {
			headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
		});
		if (!response.ok && response.status !== 404) throw new SpotifyApiError("Artist catalogue unavailable", response.status, response.headers.get("Retry-After"));
		let genres: { key: string; name: string }[] = [];
		if (response.status !== 404) {
			const payload = await response.json() as { id?: string; genres?: unknown };
			if (payload.id !== artist.id) throw new Error("Invalid artist identity");
			// Missing (deprecated) tags and explicit empty arrays both remain unclassified.
			genres = normalizeGenres(payload.genres ?? []);
		}
		await env.DB.batch([
			env.DB.prepare("DELETE FROM artist_genres WHERE spotify_artist_id = ?").bind(artist.id),
			...genres.map(({ key, name }) => env.DB.prepare("INSERT INTO artist_genres(spotify_artist_id, genre_key, name) VALUES (?, ?, ?)").bind(artist.id, key, name)),
			env.DB.prepare("UPDATE artists SET genres_checked_at = ?, genres_retry_after_ms = 0 WHERE spotify_artist_id = ?").bind(now.toISOString(), artist.id),
		]);
	} catch (error) {
		const seconds = error instanceof SpotifyApiError && error.status === 429 ? retrySeconds(error.retryAfter, now) : 86400;
		await env.DB.prepare("UPDATE artists SET genres_retry_after_ms = ? WHERE spotify_artist_id = ?").bind(now.getTime() + seconds * 1000, artist.id).run();
		if (error instanceof SpotifyApiError && [401, 403, 429].includes(error.status)) await pauseCatalogue(env.DB, seconds, now);
		console.warn(JSON.stringify({ event: "artist_genres_unavailable", status: error instanceof SpotifyApiError ? error.status : 503 }));
	}
}
