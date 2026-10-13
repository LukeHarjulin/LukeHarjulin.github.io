import type { D1Database } from "./runtime";

/** A conservative application budget, not a claim about Spotify's quota. */
export async function reserveCatalogueRequest(db: D1Database, genre = false, now = new Date()): Promise<boolean> {
	const day = now.toISOString().slice(0, 10);
	const row = await db.prepare(`UPDATE spotify_catalogue_state SET
		requests = CASE WHEN day = ? THEN requests + 1 ELSE 1 END,
		genre_requests = CASE WHEN day = ? THEN genre_requests + ? ELSE ? END,
		day = ?
		WHERE id = 1 AND retry_after_ms <= ? AND (day <> ? OR requests < 40)
			AND (? = 0 OR day <> ? OR genre_requests < 12)
		RETURNING requests`)
		.bind(day, day, Number(genre), Number(genre), day, now.getTime(), day, Number(genre), day)
		.first<{ requests: number }>();
	return row !== null;
}

export async function pauseCatalogue(db: D1Database, retrySeconds: number, now = new Date()): Promise<void> {
	await db.prepare("UPDATE spotify_catalogue_state SET retry_after_ms = MAX(retry_after_ms, ?) WHERE id = 1")
		.bind(now.getTime() + Math.max(3600, retrySeconds) * 1000).run();
}

export function retrySeconds(value: string | null, now = new Date()): number {
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds > 0) return seconds;
	const instant = Date.parse(value ?? "");
	return Number.isFinite(instant) && instant > now.getTime() ? Math.ceil((instant - now.getTime()) / 1000) : 86400;
}
