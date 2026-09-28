import type { Env } from "./runtime";
import { getAccessToken, SpotifyApiError } from "./spotify";
import { editionName, normalizedName } from "./recommendation-ranking";

interface CatalogueAlbum {
	id: string;
	name: string;
	album_type: string;
	release_date?: string;
	artists: { name: string }[];
	images?: { url: string }[];
	restrictions?: { reason: string };
	tracks?: { items: { name: string; is_playable?: boolean; available_markets?: string[] }[]; next?: string | null };
}

export interface VerifiedAlbum {
	id: string;
	name: string;
	artist: string;
	artworkUrl: string | null;
	spotifyUrl: string;
	year: number;
	tracks: string[];
}

export class CatalogueError extends Error {
	constructor(readonly service: string, readonly status: number, readonly retrySeconds = 3600) {
		super(`${service} catalogue unavailable (${status})`);
	}
}

export function safeArtwork(value: string | undefined): string | null {
	try {
		const url = new URL(value ?? "");
		return url.protocol === "https:" && url.hostname === "i.scdn.co" ? url.href : null;
	} catch { return null; }
}

export class RecommendationCatalogue {
	private token: string | undefined;
	private requests = 0;
	private verified = new Map<string, VerifiedAlbum | null>();
	constructor(private env: Env, private fetcher: typeof fetch = fetch) {}

	get remaining(): number { return 38 - this.requests; }

	private async request<T>(url: string, service: string, headers?: HeadersInit): Promise<T> {
		if (++this.requests > 38) throw new CatalogueError("request budget", 429);
		let response: Response;
		try {
			response = await this.fetcher(url, { headers, signal: AbortSignal.timeout(10000) });
		} catch { throw new CatalogueError(service, 503); }
		if (!response.ok) {
			const retry = Number(response.headers.get("Retry-After"));
			throw new CatalogueError(service, response.status, Number.isFinite(retry) && retry > 0 ? retry : 3600);
		}
		try { return await response.json() as T; }
		catch { throw new CatalogueError(service, 502); }
	}

	private async spotify<T>(path: string): Promise<T> {
		if (!this.token) {
			this.requests++;
			try { this.token = await getAccessToken(this.env, this.fetcher); }
			catch (error) {
				throw new CatalogueError("Spotify authentication", error instanceof SpotifyApiError ? error.status : 503);
			}
		}
		return this.request<T>(`https://api.spotify.com/v1${path}`, "Spotify", { Authorization: `Bearer ${this.token}` });
	}

	private async lastfm<T extends { error?: number }>(method: string, params: Record<string, string>): Promise<T> {
		if (!this.env.LASTFM_API_KEY) throw new CatalogueError("Last.fm configuration", 503);
		const query = new URLSearchParams({ method, api_key: this.env.LASTFM_API_KEY, format: "json", autocorrect: "1", ...params });
		const data = await this.request<T>(`https://ws.audioscrobbler.com/2.0/?${query}`, "Last.fm");
		if (data.error) throw new CatalogueError("Last.fm", data.error === 29 ? 429 : 502);
		return data;
	}

	async topAlbums(artist: string): Promise<string[]> {
		const data = await this.lastfm<{ error?: number; topalbums?: { album?: { name: string }[] } }>(
			"artist.getTopAlbums", { artist, limit: "8" },
		);
		return (data.topalbums?.album ?? []).map((album) => album.name).filter(Boolean);
	}

	async similarArtists(artist: string): Promise<{ name: string; match: number }[]> {
		const data = await this.lastfm<{ error?: number; similarartists?: { artist?: { name: string; match: string }[] } }>(
			"artist.getSimilar", { artist, limit: "10" },
		);
		return (data.similarartists?.artist ?? []).map((item) => ({ name: item.name, match: Number(item.match) }))
			.filter((item) => item.name && Number.isFinite(item.match) && item.match > 0);
	}

	async verify(artist: string, title: string): Promise<VerifiedAlbum | null> {
		const key = `${normalizedName(artist)}:${editionName(title)}`;
		if (this.verified.has(key)) return this.verified.get(key)!;
		const rejectedTitle = /\b(live|greatest hits|best of|compilation|soundtrack|tribute|karaoke)\b/i;
		if (rejectedTitle.test(title)) return null;
		const query = new URLSearchParams({ q: `artist:${artist} album:${title}`, type: "album", market: "GB", limit: "5" });
		const search = await this.spotify<{ albums?: { items: CatalogueAlbum[] } }>(`/search?${query}`);
		const candidates = (search.albums?.items ?? []).filter((album) =>
			album.album_type === "album" && editionName(album.name) === editionName(title)
			&& album.artists.some((a) => normalizedName(a.name) === normalizedName(artist))
			&& !rejectedTitle.test(album.name),
		).sort((a, b) => (a.release_date ?? "9999").localeCompare(b.release_date ?? "9999"));
		for (const candidate of candidates.slice(0, 2)) {
			if (!/^[a-zA-Z0-9]{22}$/.test(candidate.id)) continue;
			const album = await this.spotify<CatalogueAlbum>(`/albums/${candidate.id}?market=GB`);
			const tracks = album.tracks?.items ?? [];
			// Fail closed when availability or the full track list cannot be established.
			if (album.id !== candidate.id || editionName(album.name) !== editionName(title)
				|| !album.artists.some((a) => normalizedName(a.name) === normalizedName(artist))
				|| album.restrictions || album.album_type !== "album" || album.tracks?.next || tracks.length < 6
				|| !tracks.every((track) => track.is_playable === true
					|| (track.is_playable !== false && track.available_markets?.includes("GB")))
				|| tracks.some((track) => /\b(live at|live in|live from|live version)\b|[-(]\s*live\b/i.test(track.name))) continue;
			const info = await this.lastfm<{ error?: number; album?: { tags?: { tag?: { name: string }[] } } }>(
				"album.getInfo", { artist, album: title },
			);
			if (!info.album || info.album.tags?.tag?.some((tag) => /^(live|live albums?|compilations?|soundtracks?)$/i.test(tag.name))) continue;
			const verified: VerifiedAlbum = {
				id: album.id, name: album.name, artist,
				artworkUrl: safeArtwork(album.images?.[0]?.url), spotifyUrl: `https://open.spotify.com/album/${album.id}`,
				year: Number(album.release_date?.slice(0, 4)), tracks: tracks.map((track) => editionName(track.name)),
			};
			this.verified.set(key, verified);
			return verified;
		}
		this.verified.set(key, null);
		return null;
	}
}
