import type { Env } from "./runtime";
import { retrySeconds } from "./catalogue-budget";
import { GENRE_TAXONOMY_VERSION, identityName, lastfmGenres } from "./genre-taxonomy";

const DAY = 86400000;
class ProviderError extends Error {
	constructor(readonly cooldown: number = 0) { super("Last.fm unavailable"); }
}

export async function enrichLastfmGenres(env: Env, now = new Date(), fetcher: typeof fetch = fetch): Promise<void> {
	if (env.GENRE_ENRICHMENT_ENABLED !== "true" || !env.LASTFM_API_KEY) return;
	const time = now.getTime(), day = now.toISOString().slice(0, 10), timestamp = now.toISOString();
	const lease = await env.DB.prepare(`UPDATE lastfm_genre_state SET lease_until_ms = ?
		WHERE id = 1 AND lease_until_ms <= ? AND retry_after_ms <= ? AND (day <> ? OR requests < 100)
		RETURNING priority_date`).bind(time + 300000, time, time, day).first<{ priority_date: string }>();
	if (!lease) return;
	if (lease.priority_date !== day) {
		await env.DB.batch([
			env.DB.prepare("DELETE FROM lastfm_genre_priority"),
			env.DB.prepare(`INSERT INTO lastfm_genre_priority(artist_id, name, listening_time_ms, ambiguous)
				SELECT ra.artist_id, MIN(ra.name), SUM(COALESCE(p.listened_ms, t.duration_ms)),
					CASE WHEN COUNT(DISTINCT lower(trim(ra.name))) > 1 OR EXISTS (
						SELECT 1 FROM artists a WHERE lower(trim(a.name)) = lower(trim(ra.name))
						GROUP BY lower(trim(a.name)) HAVING COUNT(*) > 1
					) THEN 1 ELSE 0 END
				FROM plays p JOIN tracks t ON t.spotify_track_id = p.spotify_track_id
				JOIN reporting_track_artists ra ON ra.spotify_track_id = t.spotify_track_id AND ra.artist_order = 0
				LEFT JOIN genre_provider_state s ON s.artist_id = ra.artist_id AND s.provider = 'lastfm'
				WHERE NOT EXISTS (SELECT 1 FROM artist_genres g WHERE g.spotify_artist_id = ra.artist_id)
					AND COALESCE(s.retry_after_ms, 0) <= ? AND length(trim(ra.name)) > 0
				GROUP BY ra.artist_id HAVING SUM(COALESCE(p.listened_ms, t.duration_ms)) > 0
				ORDER BY SUM(COALESCE(p.listened_ms, t.duration_ms)) DESC, ra.artist_id LIMIT 100`).bind(time),
			env.DB.prepare("UPDATE lastfm_genre_state SET priority_date = ? WHERE id = 1").bind(day),
		]);
	}
	let requests = 0;
	const request = async (method: string, artist: string): Promise<any> => {
		if (requests >= 5) return null;
		const reserved = await env.DB.prepare(`UPDATE lastfm_genre_state SET
			requests = CASE WHEN day = ? THEN requests + 1 ELSE 1 END, day = ?
			WHERE id = 1 AND retry_after_ms <= ? AND (day <> ? OR requests < 100) RETURNING requests`)
			.bind(day, day, time, day).first();
		if (!reserved) return null;
		requests++;
		const query = new URLSearchParams({ method, artist, autocorrect: "0", api_key: env.LASTFM_API_KEY!, format: "json" });
		const response = await fetcher.call(globalThis, `https://ws.audioscrobbler.com/2.0/?${query}`, { signal: AbortSignal.timeout(10000) });
		if (!response.ok) throw new ProviderError(response.status === 429 ? retrySeconds(response.headers.get("Retry-After"), now) * 1000
			: [401, 403].includes(response.status) ? DAY : 0);
		const payload = await response.json() as any;
		if (!payload || typeof payload !== "object") throw new ProviderError();
		if ([6, 7].includes(payload.error)) return { missing: true };
		if (payload.error) throw new ProviderError(payload.error === 29 ? 3600000 : [4, 10, 26].includes(payload.error) ? DAY : 0);
		return payload;
	};
	// Each artist needs identity + tags. Avoid spending the final slot on an incomplete pair.
	while (requests <= 3) {
		const artist = await env.DB.prepare(`SELECT q.artist_id AS id, q.name, q.ambiguous, COALESCE(s.failures, 0) AS failures
			FROM lastfm_genre_priority q LEFT JOIN genre_provider_state s ON s.artist_id = q.artist_id AND s.provider = 'lastfm'
			WHERE COALESCE(s.retry_after_ms, 0) <= ?
				AND NOT EXISTS (SELECT 1 FROM artist_genres g WHERE g.spotify_artist_id = q.artist_id)
			ORDER BY q.listening_time_ms DESC, q.artist_id LIMIT 1`).bind(time)
			.first<{ id: string; name: string; ambiguous: number; failures: number }>();
		if (!artist) break;
		let status = "ambiguous", retry = time + 30 * DAY;
		try {
			let genres: { key: string; name: string }[] = [];
			if (!artist.ambiguous) {
				const info = await request("artist.getInfo", artist.name);
				if (info === null) break;
				if (info.missing) {
					status = "empty";
				} else {
					const identity = info.artist;
					const bio = identity?.bio?.content ?? identity?.bio?.summary;
					if (typeof identity?.name !== "string" || typeof bio !== "string") throw new ProviderError();
					// Last.fm merges same-name artists. Reject numbered biographies and explicit collision notices.
					const text = bio.replace(/<[^>]*>/g, " ").trim();
					const ambiguous = /^\s*(?:\(?1[.)]|1\s*[-:])/.test(text)
						|| /(?:multiple|several|different|\b[2-9]\b|two|three|four|five)\s+(?:\w+\s+){0,4}(?:artists|bands|acts|musicians)|(?:artists|bands|acts)\s+(?:\w+\s+){0,4}(?:same name|named|called)|more than one/i.test(text);
					if (identityName(identity.name) === identityName(artist.name) && text.length > 0
						&& typeof identity.mbid === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(identity.mbid) && !ambiguous) {
						const tags = await request("artist.getTopTags", artist.name);
						if (tags === null) break;
						if (!tags.missing) {
							if (typeof tags.toptags?.["@attr"]?.artist !== "string"
								|| identityName(tags.toptags["@attr"].artist) !== identityName(artist.name)) throw new ProviderError();
							genres = lastfmGenres(tags.toptags.tag);
						}
						status = genres.length ? "success" : "empty";
						retry = time + (genres.length ? 90 : 30) * DAY;
					}
				}
			}
			await env.DB.batch([
				env.DB.prepare("DELETE FROM lastfm_artist_genres WHERE artist_id = ?").bind(artist.id),
				...genres.map(({ key, name }) => env.DB.prepare("INSERT INTO lastfm_artist_genres VALUES (?, ?, ?)").bind(artist.id, key, name)),
				env.DB.prepare(`INSERT INTO genre_provider_state(artist_id, provider, status, attempted_at, classified_at, retry_after_ms, taxonomy_version)
					VALUES (?, 'lastfm', ?, ?, ?, ?, ?) ON CONFLICT(artist_id, provider) DO UPDATE SET
					status = excluded.status, attempted_at = excluded.attempted_at,
					classified_at = excluded.classified_at,
					retry_after_ms = excluded.retry_after_ms, failures = 0,
					taxonomy_version = excluded.taxonomy_version`)
					.bind(artist.id, status, timestamp, status === "success" ? timestamp : null, retry, GENRE_TAXONOMY_VERSION),
			]);
		} catch (error) {
			const backoff = Math.min(DAY, 3600000 * 2 ** Math.min(artist.failures, 5));
			const cooldown = error instanceof ProviderError ? error.cooldown : 0;
			await env.DB.prepare(`INSERT INTO genre_provider_state(artist_id, provider, status, attempted_at, retry_after_ms, failures)
				VALUES (?, 'lastfm', 'error', ?, ?, 1) ON CONFLICT(artist_id, provider) DO UPDATE SET
				status = 'error', attempted_at = excluded.attempted_at, retry_after_ms = excluded.retry_after_ms, failures = failures + 1`)
				.bind(artist.id, timestamp, time + Math.max(backoff, cooldown)).run();
			// Only sanitized event names are logged; URLs contain the API key.
			console.warn("Last.fm genre enrichment unavailable");
			if (cooldown) {
				await env.DB.prepare("UPDATE lastfm_genre_state SET retry_after_ms = MAX(retry_after_ms, ?) WHERE id = 1").bind(time + cooldown).run();
				break;
			}
		}
	}
}
