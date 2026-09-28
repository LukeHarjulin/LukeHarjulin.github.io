import type { AlbumRecommendation, RecommendationKind } from "../../../src/data/album-recommendation";
import { reportingDate } from "./periods";

export interface HistoryTrack {
	artist: string;
	album: string;
	track: string;
	plays: number;
	lastPlayed: string;
}

export interface HistoryAlbum {
	artist: string;
	name: string;
	plays: number;
	tracks: Set<string>;
	lastPlayed: string;
}

export function normalizedName(value: string): string {
	const folded = value.normalize("NFKD").toLowerCase();
	return folded.replace(/[^\p{L}\p{N}]/gu, "") || folded.trim();
}

export function editionName(value: string): string {
	return normalizedName(value.replace(
		/\s*[([][^)\]]*(?:remaster|deluxe|expanded|anniversary|edition|reissue)[^)\]]*[)\]]|\s*[-–]\s*[^]*?(?:remaster|deluxe|expanded|anniversary|reissue)[^]*$/gi,
		"",
	));
}

export function albumKey(artist: string, album: string): string {
	return `${normalizedName(artist)}:${editionName(album)}`;
}

export function groupHistory(rows: HistoryTrack[]): HistoryAlbum[] {
	const albums = new Map<string, HistoryAlbum>();
	for (const row of rows) {
		if (!row.artist || !row.album) continue;
		const key = albumKey(row.artist, row.album);
		const album = albums.get(key) ?? {
			artist: row.artist, name: row.album, plays: 0, tracks: new Set<string>(), lastPlayed: row.lastPlayed,
		};
		album.plays += row.plays;
		if (row.plays > 0) album.tracks.add(editionName(row.track));
		if (row.lastPlayed > album.lastPlayed) album.lastPlayed = row.lastPlayed;
		albums.set(key, album);
	}
	return [...albums.values()];
}

// Calendar months, clamped to the target month's last day (e.g. April 30 -> February 28).
export function rediscoveryCutoff(now: Date): string {
	const [year, month, day] = reportingDate(now).split("-").map(Number);
	const target = new Date(Date.UTC(year, month - 3, 1));
	const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(day, lastDay));
	return target.toISOString().slice(0, 10);
}

export function rankRediscoveries(albums: HistoryAlbum[], now: Date, recent = new Set<string>()): HistoryAlbum[] {
	const cutoff = rediscoveryCutoff(now);
	const score = (album: HistoryAlbum) => {
		const gapDays = Math.max(0, (now.getTime() - Date.parse(album.lastPlayed)) / 86400000);
		return Math.log1p(album.plays) * Math.sqrt(Math.min(album.tracks.size, 12))
			* (1 + Math.min(gapDays / 365, 2)) * (recent.has(albumKey(album.artist, album.name)) ? 0.2 : 1);
	};
	return albums.filter((album) => album.plays >= 6 && album.tracks.size >= 3
		&& reportingDate(new Date(album.lastPlayed)) <= cutoff)
		.sort((a, b) => score(b) - score(a) || albumKey(a.artist, a.name).localeCompare(albumKey(b.artist, b.name)));
}

export function dailyKind(date: string): RecommendationKind {
	const slot = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000) % 10;
	return slot === 8 ? "exploration" : slot === 9 ? "discovery" : "rediscovery";
}

// Eight rediscoveries, one exploration and one discovery when each pool is available.
// Rotate the first slot over ten days so the headline pick follows the same mix.
export function orderDailyPicks(items: AlbumRecommendation[], date: string): AlbumRecommendation[] {
	const wanted = dailyKind(date);
	const first = items.find((item) => item.kind === wanted) ?? items[0];
	return first ? [first, ...items.filter((item) => item.id !== first.id)] : [];
}
