import { calendarRange } from "./periods";
import type { D1Database } from "./runtime";

export interface GenreRow { month: number; key: string | null; name: string | null; listeningTimeMs: number }
export interface GenreBucket { kind: "genre" | "other" | "unknown"; name: string; listeningTimeMs: number; sharePercent: number }
interface MonthlyArtist { month: number; id: string; name: string; spotifyUrl: string | null; plays: number; listeningTimeMs: number }

export function genreBreakdown(rows: GenreRow[]) {
	const grouped = new Map<string, { name: string; listeningTimeMs: number }>();
	let unknownTimeMs = 0;
	for (const row of rows) {
		if (row.key === null) { unknownTimeMs += row.listeningTimeMs; continue; }
		const entry = grouped.get(row.key) ?? { name: row.name!, listeningTimeMs: 0 };
		entry.listeningTimeMs += row.listeningTimeMs;
		grouped.set(row.key, entry);
	}
	const known = [...grouped.values()].filter((entry) => entry.listeningTimeMs > 0)
		.sort((a, b) => b.listeningTimeMs - a.listeningTimeMs || a.name.localeCompare(b.name));
	const identifiedTimeMs = known.reduce((sum, entry) => sum + entry.listeningTimeMs, 0);
	const totalTimeMs = identifiedTimeMs + unknownTimeMs;
	const share = (value: number) => totalTimeMs > 0 ? value / totalTimeMs * 100 : 0;
	const genres: GenreBucket[] = known.slice(0, 10).map((entry) => ({ ...entry, kind: "genre", sharePercent: share(entry.listeningTimeMs) }));
	const other = known.slice(10).reduce((sum, entry) => sum + entry.listeningTimeMs, 0);
	if (other > 0) genres.push({ kind: "other", name: "Other", listeningTimeMs: other, sharePercent: share(other) });
	if (unknownTimeMs > 0) genres.push({ kind: "unknown", name: "Unknown", listeningTimeMs: unknownTimeMs, sharePercent: share(unknownTimeMs) });
	return { genres, topGenre: known[0] ?? null, genreCoverage: { identifiedTimeMs, totalTimeMs, percentage: share(identifiedTimeMs) } };
}

export async function getTasteTrends(db: D1Database, year: number, month: number | null) {
	const ranges = (month === null ? Array.from({ length: 12 }, (_, index) => index + 1) : [month])
		.map((month) => ({ month, ...calendarRange(year, month) }));
	const bindings = ranges.flatMap(({ month, start, end }) => [month, start, end]);
	const months = `months(month, start, end) AS (VALUES ${ranges.map(() => "(?, ?, ?)").join(", ")})`;
	const trackTotals = `track_totals AS MATERIALIZED (
		SELECT m.month, p.spotify_track_id, COUNT(*) AS plays,
			SUM(COALESCE(p.listened_ms, t.duration_ms)) AS listeningTimeMs
		FROM months m JOIN plays p ON p.played_at >= m.start AND p.played_at < m.end
		JOIN tracks t ON t.spotify_track_id = p.spotify_track_id
		GROUP BY m.month, p.spotify_track_id
	)`;
	const [genreResult, artistResult] = await Promise.all([
		db.prepare(`WITH ${months}, ${trackTotals}, tags AS (
			SELECT spotify_artist_id, genre_key, name, COUNT(*) OVER (PARTITION BY spotify_artist_id) AS count
			FROM artist_genres
		)
		SELECT tt.month, tags.genre_key AS key, MIN(tags.name) AS name,
			SUM(tt.listeningTimeMs * 1.0 / COALESCE(tags.count, 1)) AS listeningTimeMs
		FROM track_totals tt
		LEFT JOIN reporting_track_artists ra ON ra.spotify_track_id = tt.spotify_track_id AND ra.artist_order = 0
		LEFT JOIN tags ON tags.spotify_artist_id = ra.artist_id
		GROUP BY tt.month, tags.genre_key ORDER BY tt.month, tags.genre_key`).bind(...bindings).all<GenreRow>(),
		month === null ? db.prepare(`WITH ${months}, ${trackTotals}, ranked AS (
			SELECT tt.month, ra.artist_id AS id, ra.name, ra.spotify_url AS spotifyUrl,
				SUM(tt.plays) AS plays, SUM(tt.listeningTimeMs) AS listeningTimeMs,
				ROW_NUMBER() OVER (PARTITION BY tt.month ORDER BY SUM(tt.listeningTimeMs) DESC,
					SUM(tt.plays) DESC, ra.name COLLATE NOCASE, ra.artist_id) AS rank
			FROM track_totals tt JOIN reporting_track_artists ra ON ra.spotify_track_id = tt.spotify_track_id
			GROUP BY tt.month, ra.artist_id, ra.name, ra.spotify_url
		)
		SELECT month, id, name, spotifyUrl, plays, listeningTimeMs FROM ranked WHERE rank = 1`).bind(...bindings).all<MonthlyArtist>()
			: Promise.resolve({ results: [] as MonthlyArtist[] }),
	]);
	const genreRows = genreResult.results ?? [];
	return {
		period: genreBreakdown(genreRows),
		months: new Map(ranges.map(({ month }) => [month, {
			topArtist: (artistResult.results ?? []).find((artist) => artist.month === month) ?? null,
			topGenre: genreBreakdown(genreRows.filter((row) => row.month === month)).topGenre,
		}])),
	};
}
