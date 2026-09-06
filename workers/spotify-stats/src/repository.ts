import type { D1Database, D1PreparedStatement } from "./runtime";
import { groupActivityByReportingDate } from "./periods";
import type { PublicArtist, PublicTrack } from "./types";

interface TrackRow {
	id: string;
	name: string;
	durationMs: number;
	spotifyUrl: string | null;
	albumId: string;
	albumName: string;
	artworkUrl: string | null;
	artistsJson: string;
}

interface RecentRow extends TrackRow {
	playedAt: string;
}

function parseArtists(value: string): PublicArtist[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed.filter((artist): artist is PublicArtist => (
			typeof artist === "object"
			&& artist !== null
			&& typeof (artist as PublicArtist).id === "string"
			&& typeof (artist as PublicArtist).name === "string"
		)) : [];
	} catch {
		return [];
	}
}

function mapTrack(row: TrackRow): PublicTrack {
	return {
		id: row.id,
		name: row.name,
		artists: parseArtists(row.artistsJson),
		album: {
			id: row.albumId,
			name: row.albumName,
			artworkUrl: row.artworkUrl,
		},
		durationMs: row.durationMs,
		spotifyUrl: row.spotifyUrl,
	};
}

const TRACK_COLUMNS = `
		t.spotify_track_id AS id,
		t.name,
		t.duration_ms AS durationMs,
		t.spotify_url AS spotifyUrl,
		COALESCE(a.spotify_album_id, '') AS albumId,
		COALESCE(a.name, t.history_album_name, '') AS albumName,
		a.artwork_url AS artworkUrl,
		COALESCE((
			SELECT json_group_array(json_object('id', artist.artist_id, 'name', artist.name))
			FROM (
				SELECT ordered_artist.artist_id, ordered_artist.name
				FROM reporting_track_artists ordered_artist
				WHERE ordered_artist.spotify_track_id = t.spotify_track_id
				ORDER BY ordered_artist.artist_order
			) artist
		), '[]') AS artistsJson
`;

function periodFilter(start: string | null, alias = "p"): string {
	return start ? `${alias}.played_at >= ?` : "1 = 1";
}

function bindPeriod(
	statement: D1PreparedStatement,
	start: string | null,
	...values: unknown[]
): D1PreparedStatement {
	return statement.bind(...(start ? [start, ...values] : values));
}

export async function getMostRecentPlay(db: D1Database): Promise<{ track: PublicTrack; playedAt: string } | null> {
	const row = await db.prepare(`
		SELECT ${TRACK_COLUMNS}, p.played_at AS playedAt
		FROM tracks t
		LEFT JOIN albums a ON a.spotify_album_id = t.spotify_album_id
		JOIN plays p ON p.spotify_track_id = t.spotify_track_id
		ORDER BY p.played_at DESC
		LIMIT 1
	`).first<RecentRow>();

	return row ? { track: mapTrack(row), playedAt: row.playedAt } : null;
}

export async function getSummary(db: D1Database, start: string | null) {
	return bindPeriod(db.prepare(`
		WITH filtered_plays AS (
			SELECT p.id, p.spotify_track_id, p.listened_ms
			FROM plays p
			WHERE ${periodFilter(start)}
		)
		SELECT
			COUNT(*) AS plays,
			COALESCE(SUM(COALESCE(fp.listened_ms, t.duration_ms)), 0) AS listeningTimeMs,
			(
				SELECT COUNT(DISTINCT artist.artist_id)
				FROM filtered_plays fp
				JOIN reporting_track_artists artist ON artist.spotify_track_id = fp.spotify_track_id
			) AS uniqueArtists,
			COUNT(DISTINCT fp.spotify_track_id) AS uniqueTracks
		FROM filtered_plays fp
		JOIN tracks t ON t.spotify_track_id = fp.spotify_track_id
	`), start).first<{
		plays: number;
		listeningTimeMs: number;
		uniqueArtists: number;
		uniqueTracks: number;
	}>();
}

export async function getTopArtists(db: D1Database, start: string | null, limit: number) {
	const result = await bindPeriod(db.prepare(`
		SELECT
			artist.artist_id AS id,
			artist.name,
			artist.spotify_url AS spotifyUrl,
			COUNT(*) AS plays,
			COALESCE(SUM(COALESCE(p.listened_ms, t.duration_ms)), 0) AS listeningTimeMs
		FROM plays p
		JOIN tracks t ON t.spotify_track_id = p.spotify_track_id
		JOIN reporting_track_artists artist ON artist.spotify_track_id = p.spotify_track_id
		WHERE ${periodFilter(start)}
		GROUP BY artist.artist_id, artist.name, artist.spotify_url
		ORDER BY plays DESC, artist.name COLLATE NOCASE
		LIMIT ?
	`), start, limit).all();
	return result.results ?? [];
}

export async function getTopTracks(db: D1Database, start: string | null, limit: number) {
	const result = await bindPeriod(db.prepare(`
		SELECT ${TRACK_COLUMNS},
			COUNT(*) AS plays,
			COALESCE(SUM(COALESCE(p.listened_ms, t.duration_ms)), 0) AS listeningTimeMs
		FROM tracks t
		LEFT JOIN albums a ON a.spotify_album_id = t.spotify_album_id
		JOIN plays p ON p.spotify_track_id = t.spotify_track_id
		WHERE ${periodFilter(start)}
		GROUP BY t.spotify_track_id
		ORDER BY COUNT(*) DESC, t.name COLLATE NOCASE
		LIMIT ?
	`), start, limit).all<TrackRow & { plays: number; listeningTimeMs: number }>();

	return (result.results ?? []).map((row) => ({
		track: mapTrack(row),
		plays: row.plays,
		listeningTimeMs: row.listeningTimeMs,
	}));
}

export async function getActivity(db: D1Database, start: string | null) {
	const result = await bindPeriod(db.prepare(`
		SELECT
			p.played_at AS playedAt,
			COALESCE(p.listened_ms, t.duration_ms) AS durationMs
		FROM plays p
		JOIN tracks t ON t.spotify_track_id = p.spotify_track_id
		WHERE ${periodFilter(start)}
		ORDER BY p.played_at
	`), start).all<{ playedAt: string; durationMs: number }>();
	return groupActivityByReportingDate(result.results ?? []);
}

export async function searchArchive(
	db: D1Database,
	query: string,
	limit: number,
	yearStart: string,
	monthStart: string,
) {
	const escapedQuery = query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
	const result = await db.prepare(`
		SELECT ${TRACK_COLUMNS},
			MIN(p.played_at) AS firstPlayed,
			MAX(p.played_at) AS lastPlayed,
			COUNT(*) AS totalPlays,
			SUM(CASE WHEN p.played_at >= ? THEN 1 ELSE 0 END) AS playsThisYear,
			SUM(CASE WHEN p.played_at >= ? THEN 1 ELSE 0 END) AS playsThisMonth,
			COALESCE(SUM(COALESCE(p.listened_ms, t.duration_ms)), 0) AS totalListeningTimeMs
		FROM tracks t
		LEFT JOIN albums a ON a.spotify_album_id = t.spotify_album_id
		JOIN plays p ON p.spotify_track_id = t.spotify_track_id
		WHERE t.name LIKE ? ESCAPE '\\'
		GROUP BY t.spotify_track_id
		ORDER BY COUNT(*) DESC, t.name COLLATE NOCASE
		LIMIT ?
	`).bind(yearStart, monthStart, `%${escapedQuery}%`, limit).all<TrackRow & {
		firstPlayed: string;
		lastPlayed: string;
		totalPlays: number;
		playsThisYear: number;
		playsThisMonth: number;
		totalListeningTimeMs: number;
	}>();

	return (result.results ?? []).map((row) => ({
		track: mapTrack(row),
		firstPlayed: row.firstPlayed,
		lastPlayed: row.lastPlayed,
		totalPlays: row.totalPlays,
		playsThisYear: row.playsThisYear,
		playsThisMonth: row.playsThisMonth,
		totalListeningTimeMs: row.totalListeningTimeMs,
	}));
}

export async function getRecentPlays(db: D1Database, limit: number) {
	const result = await db.prepare(`
		SELECT ${TRACK_COLUMNS}, p.played_at AS playedAt
		FROM tracks t
		LEFT JOIN albums a ON a.spotify_album_id = t.spotify_album_id
		JOIN plays p ON p.spotify_track_id = t.spotify_track_id
		ORDER BY p.played_at DESC
		LIMIT ?
	`).bind(limit).all<RecentRow>();

	return (result.results ?? []).map((row) => ({
		track: mapTrack(row),
		playedAt: row.playedAt,
	}));
}

export async function getLifetimeTotals(db: D1Database) {
	return db.prepare(`
		SELECT
			COUNT(*) AS plays,
			COALESCE(SUM(COALESCE(p.listened_ms, t.duration_ms)), 0) AS listeningTimeMs,
			(
				SELECT COUNT(DISTINCT artist.artist_id)
				FROM plays artist_plays
				JOIN reporting_track_artists artist
					ON artist.spotify_track_id = artist_plays.spotify_track_id
			) AS uniqueArtists,
			COUNT(DISTINCT p.spotify_track_id) AS uniqueTracks,
			MIN(p.played_at) AS firstPlayed,
			MAX(p.played_at) AS lastPlayed
		FROM plays p
		JOIN tracks t ON t.spotify_track_id = p.spotify_track_id
	`).first();
}
