import type { AlbumRecommendation, AlbumRecommendations, RecommendationKind } from "../../../src/data/album-recommendation";
import type { D1Database, Env } from "./runtime";
import { reportingDate } from "./periods";
import { CatalogueError, RecommendationCatalogue, type VerifiedAlbum } from "./recommendation-catalogue";
import {
	albumKey, editionName, groupHistory, normalizedName, orderDailyPicks, rankRediscoveries,
	type HistoryAlbum, type HistoryTrack,
} from "./recommendation-ranking";

export const HISTORY_QUERY = `
	WITH track_history AS MATERIALIZED (
		SELECT p.spotify_track_id,
			SUM(CASE WHEN COALESCE(p.listened_ms, t.duration_ms) >= 30000 THEN 1 ELSE 0 END) AS plays,
			MAX(p.played_at) AS lastPlayed
		FROM plays p JOIN tracks t ON t.spotify_track_id = p.spotify_track_id
		GROUP BY p.spotify_track_id
	)
	SELECT COALESCE(ra.name, t.history_artist_name, '') AS artist,
		COALESCE(a.name, t.history_album_name, '') AS album,
		t.name AS track, h.plays, h.lastPlayed
	FROM track_history h JOIN tracks t ON t.spotify_track_id = h.spotify_track_id
	LEFT JOIN albums a ON a.spotify_album_id = t.spotify_album_id
	LEFT JOIN reporting_track_artists ra ON ra.spotify_track_id = t.spotify_track_id AND ra.artist_order = 0
`;

interface Snapshot { date: string; generated_at: string; payload: string }

export async function readRecommendations(db: D1Database, now = new Date()): Promise<AlbumRecommendations> {
	const date = reportingDate(now);
	const row = await db.prepare(`SELECT date, generated_at, payload FROM album_recommendation_days
		WHERE payload IS NOT NULL AND date <= ? AND generated_at >= ? ORDER BY date DESC LIMIT 1`)
		.bind(date, new Date(now.getTime() - 3 * 86400000).toISOString()).first<Snapshot>();
	return {
		date: row?.date ?? date, generatedAt: row?.generated_at ?? null,
		stale: Boolean(row && row.date !== date), items: row ? JSON.parse(row.payload) as AlbumRecommendation[] : [],
	};
}

function toPick(album: VerifiedAlbum, kind: RecommendationKind, reason: string): AlbumRecommendation {
	return { id: album.id, name: album.name, artist: album.artist, artworkUrl: album.artworkUrl, spotifyUrl: album.spotifyUrl, kind, reason };
}

function heardTracks(album: VerifiedAlbum, history: HistoryAlbum[]): number {
	const tracks = new Set(history.filter((item) => normalizedName(item.artist) === normalizedName(album.artist))
		.flatMap((item) => [...item.tracks]));
	return album.tracks.filter((track) => tracks.has(track)).length;
}

// Explicit negative feedback from the local trial. Familiarity alone is not negative feedback.
const excluded = new Set([
	["Dokken", "Hell to Pay"], ["Scorpions", "Humanity - Hour I"], ["Black Sabbath", "13"],
	["Warrant", "Born Again"], ["Judas Priest", "Angel of Retribution"], ["Fleetwood Mac", "The Dance"],
	["Heaven & Hell", "The Devil You Know"], ["Halford", "Resurrection"], ["Elf", "Elf"],
	["Superjoint Ritual", "A Lethal Dose of American Hatred"], ["Running Wild", "20 Years in History"],
	["Lindsey Buckingham", "Law and Order"],
].map(([artist, album]) => albumKey(artist, album)));

export async function buildRecommendations(
	history: HistoryAlbum[], catalogue: RecommendationCatalogue, now: Date, recent: Set<string>,
): Promise<AlbumRecommendation[]> {
	const date = reportingDate(now);
	const picks: AlbumRecommendation[] = [];
	const usedArtists = new Set<string>();
	const allowed = (artist: string, album: string) => !excluded.has(albumKey(artist, album));
	const add = (album: VerifiedAlbum, kind: RecommendationKind, reason: string) => {
		if (picks.some((item) => item.id === album.id) || usedArtists.has(normalizedName(album.artist))) return;
		picks.push(toPick(album, kind, reason));
		usedArtists.add(normalizedName(album.artist));
	};
	const artists = new Map<string, { name: string; plays: number; albums: HistoryAlbum[] }>();
	for (const album of history) {
		const key = normalizedName(album.artist);
		const artist = artists.get(key) ?? { name: album.artist, plays: 0, albums: [] };
		artist.plays += album.plays;
		artist.albums.push(album);
		artists.set(key, artist);
	}
	const seeds = [...artists.values()].filter((artist) => artist.plays > 0).sort((a, b) => b.plays - a.plays).slice(0, 20);
	const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
	try {
		for (const candidate of rankRediscoveries(history, now, recent)) {
			if (picks.length >= 8 || catalogue.remaining < 16) break;
			if (usedArtists.has(normalizedName(candidate.artist)) || !allowed(candidate.artist, candidate.name)) continue;
			const album = await catalogue.verify(candidate.artist, candidate.name);
			if (!album) continue;
			add(album, "rediscovery", `You played ${candidate.tracks.size} tracks from this album across ${candidate.plays} plays. Last heard ${reportingDate(new Date(candidate.lastPlayed))}.`);
		}
		const rotatedSeeds = [...seeds.slice(day % seeds.length), ...seeds.slice(0, day % seeds.length)];
		const seed = rotatedSeeds.find((artist) => !usedArtists.has(normalizedName(artist.name)));
		if (seed && !usedArtists.has(normalizedName(seed.name)) && catalogue.remaining >= 7) {
			const anchor = [...seed.albums].sort((a, b) => b.plays - a.plays)[0];
			const anchorAlbum = await catalogue.verify(seed.name, anchor.name);
			if (anchorAlbum && Number.isFinite(anchorAlbum.year)) {
				for (const title of await catalogue.topAlbums(seed.name)) {
					if (catalogue.remaining < 6) break;
					if (!allowed(seed.name, title) || history.some((item) => albumKey(item.artist, item.name) === albumKey(seed.name, title) && item.tracks.size > 2)) continue;
					const album = await catalogue.verify(seed.name, title);
					if (!album || !Number.isFinite(album.year) || Math.abs(album.year - anchorAlbum.year) > 10) continue;
					const known = heardTracks(album, history);
					if (known > 2 || known / album.tracks.length > 0.25) continue;
					add(album, "exploration", `More from ${seed.name}, close to the release era of ${anchor.name}, one of your most-played albums by this artist.`);
					break;
				}
			}
		}
		if (seeds.length && catalogue.remaining >= 6) {
			const related = new Map<string, { name: string; score: number; seeds: string[] }>();
			for (const seedArtist of [seeds[day % seeds.length], seeds[(day + 1) % seeds.length]]) {
				for (const artist of await catalogue.similarArtists(seedArtist.name)) {
					const key = normalizedName(artist.name);
					if (artists.has(key)) continue;
					const match = related.get(key) ?? { name: artist.name, score: 0, seeds: [] };
					match.score += artist.match * Math.log1p(seedArtist.plays);
					match.seeds.push(seedArtist.name);
					related.set(key, match);
				}
			}
			for (const artist of [...related.values()].sort((a, b) => b.score - a.score)) {
				if (catalogue.remaining < 4) break;
				for (const title of await catalogue.topAlbums(artist.name)) {
					if (catalogue.remaining < 3) break;
					if (!allowed(artist.name, title)) continue;
					const album = await catalogue.verify(artist.name, title);
					if (!album) continue;
					add(album, "discovery", `Last.fm connects ${artist.name} with ${[...new Set(artist.seeds)].join(" and ")}, artists in your long-term listening history.`);
					break;
				}
				if (picks.some((item) => item.kind === "discovery")) break;
			}
		}
	} catch (error) {
		// Preserve verified picks on partial upstream failure; never log request URLs or keys.
		if (!(error instanceof CatalogueError) || !picks.length) throw error;
		console.warn(JSON.stringify({ event: "album_recommendations_partial", service: error.service, status: error.status }));
	}
	return orderDailyPicks(picks, date);
}

export async function refreshRecommendations(env: Env, now = new Date(), fetcher: typeof fetch = fetch): Promise<void> {
	if (env.RECOMMENDATIONS_ENABLED !== "true" || !env.LASTFM_API_KEY) return;
	const date = reportingDate(now);
	const owner = crypto.randomUUID();
	// Atomic lease suppresses duplicate crons and expensive repeated failed attempts.
	const lease = await env.DB.prepare(`INSERT INTO album_recommendation_days (date, retry_after_ms, lease_owner)
		VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET retry_after_ms = excluded.retry_after_ms, lease_owner = excluded.lease_owner
		WHERE album_recommendation_days.payload IS NULL AND album_recommendation_days.retry_after_ms <= ? RETURNING lease_owner`)
		.bind(date, now.getTime() + 3600000, owner, now.getTime()).first<{ lease_owner: string }>();
	if (lease?.lease_owner !== owner) return;
	try {
		const rows = await env.DB.prepare(HISTORY_QUERY).all<HistoryTrack>();
		const previous = await env.DB.prepare(`SELECT payload FROM album_recommendation_days
			WHERE date < ? AND payload IS NOT NULL ORDER BY date DESC LIMIT 14`).bind(date).all<{ payload: string }>();
		const recent = new Set((previous.results ?? []).flatMap((row) =>
			(JSON.parse(row.payload) as AlbumRecommendation[]).slice(0, 1).map((item) => albumKey(item.artist, item.name))));
		const items = await buildRecommendations(groupHistory(rows.results ?? []), new RecommendationCatalogue(env, fetcher), now, recent);
		if (!items.length) return;
		await env.DB.prepare(`UPDATE album_recommendation_days SET payload = ?, generated_at = ?
			WHERE date = ? AND lease_owner = ?`).bind(JSON.stringify(items), now.toISOString(), date, owner).run();
		await env.DB.prepare("DELETE FROM album_recommendation_days WHERE date < ?")
			.bind(new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)).run();
		console.info(JSON.stringify({ event: "album_recommendations_ready", date, count: items.length }));
	} catch (error) {
		const retry = error instanceof CatalogueError ? Math.max(3600, error.retrySeconds) : 3600;
		await env.DB.prepare("UPDATE album_recommendation_days SET retry_after_ms = ? WHERE date = ? AND lease_owner = ?")
			.bind(now.getTime() + retry * 1000, date, owner).run();
		console.warn(JSON.stringify({ event: "album_recommendations_failed", status: error instanceof CatalogueError ? error.status : 500 }));
	}
}
