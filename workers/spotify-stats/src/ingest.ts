import type { Env } from "./runtime";
import { getRecentlyPlayed } from "./spotify";
import type { NormalizedPlay, SpotifyPlayItem } from "./types";

const CURSOR_KEY = "recently_played_after_ms";

export function normalizePlay(item: SpotifyPlayItem): NormalizedPlay | null {
	if (!item.track?.id || !item.played_at) {
		return null;
	}

	const playedAtUnixMs = Date.parse(item.played_at);
	if (!Number.isFinite(playedAtUnixMs)) {
		return null;
	}

	return {
		track: item.track,
		playedAt: new Date(playedAtUnixMs).toISOString(),
		playedAtUnixMs,
		contextType: item.context?.type ?? null,
		contextUri: item.context?.uri ?? null,
	};
}

export function deduplicatePlays(plays: NormalizedPlay[]): NormalizedPlay[] {
	const unique = new Map<string, NormalizedPlay>();
	for (const play of plays) {
		unique.set(`${play.track.id}\u0000${play.playedAt}`, play);
	}
	return [...unique.values()].sort((a, b) => a.playedAtUnixMs - b.playedAtUnixMs);
}

async function readCursor(env: Env): Promise<number | null> {
	const value = await env.DB.prepare(
		"SELECT value FROM ingestion_state WHERE key = ?",
	).bind(CURSOR_KEY).first<string>("value");

	if (value === null) {
		return null;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

export async function ingestRecentlyPlayed(env: Env): Promise<{ received: number; accepted: number }> {
	const cursor = await readCursor(env);
	const response = await getRecentlyPlayed(env, cursor);
	const plays = deduplicatePlays(
		response.items.map(normalizePlay).filter((play): play is NormalizedPlay => play !== null),
	);

	if (plays.length === 0) {
		return { received: response.items.length, accepted: 0 };
	}

	const statements = [];
	const tracks = new Map(plays.map((play) => [play.track.id, play.track]));

	for (const track of tracks.values()) {
		statements.push(env.DB.prepare(`
			INSERT INTO albums (
				spotify_album_id, name, album_type, release_date, artwork_url, spotify_url
			) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (spotify_album_id) DO UPDATE SET
				name = excluded.name,
				album_type = excluded.album_type,
				release_date = excluded.release_date,
				artwork_url = excluded.artwork_url,
				spotify_url = excluded.spotify_url,
				updated_at = CURRENT_TIMESTAMP
		`).bind(
			track.album.id,
			track.album.name,
			track.album.album_type ?? null,
			track.album.release_date ?? null,
			track.album.images?.[0]?.url ?? null,
			track.album.external_urls?.spotify ?? null,
		));

		for (const artist of track.artists) {
			statements.push(env.DB.prepare(`
				INSERT INTO artists (spotify_artist_id, name, spotify_url)
				VALUES (?, ?, ?)
				ON CONFLICT (spotify_artist_id) DO UPDATE SET
					name = excluded.name,
					spotify_url = excluded.spotify_url,
					updated_at = CURRENT_TIMESTAMP
			`).bind(artist.id, artist.name, artist.external_urls?.spotify ?? null));
		}

		statements.push(env.DB.prepare(`
			INSERT INTO tracks (
				spotify_track_id, spotify_album_id, name, duration_ms, explicit, spotify_url
			) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (spotify_track_id) DO UPDATE SET
				spotify_album_id = excluded.spotify_album_id,
				name = excluded.name,
				duration_ms = excluded.duration_ms,
				explicit = excluded.explicit,
				spotify_url = excluded.spotify_url,
				updated_at = CURRENT_TIMESTAMP
		`).bind(
			track.id,
			track.album.id,
			track.name,
			track.duration_ms,
			track.explicit ? 1 : 0,
			track.external_urls?.spotify ?? null,
		));

		statements.push(env.DB.prepare(
			"DELETE FROM track_artists WHERE spotify_track_id = ?",
		).bind(track.id));

		track.artists.forEach((artist, index) => {
			statements.push(env.DB.prepare(`
				INSERT INTO track_artists (spotify_track_id, spotify_artist_id, artist_order)
				VALUES (?, ?, ?)
			`).bind(track.id, artist.id, index));
		});
	}

	for (const play of plays) {
		statements.push(env.DB.prepare(`
			INSERT OR IGNORE INTO plays (
				spotify_track_id, played_at, played_at_unix_ms, context_type, context_uri
			) VALUES (?, ?, ?, ?, ?)
		`).bind(
			play.track.id,
			play.playedAt,
			play.playedAtUnixMs,
			play.contextType,
			play.contextUri,
		));
	}

	const newestCursor = plays[plays.length - 1].playedAtUnixMs;
	statements.push(env.DB.prepare(`
		INSERT INTO ingestion_state (key, value)
		VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET
			value = excluded.value,
			updated_at = CURRENT_TIMESTAMP
	`).bind(CURSOR_KEY, String(newestCursor)));

	await env.DB.batch(statements);
	return { received: response.items.length, accepted: plays.length };
}
