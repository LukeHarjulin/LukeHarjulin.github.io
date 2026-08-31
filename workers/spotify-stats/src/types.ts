export interface SpotifyImage {
	url: string;
	height?: number | null;
	width?: number | null;
}

export interface SpotifyArtist {
	id: string;
	name: string;
	external_urls?: { spotify?: string };
}

export interface SpotifyAlbum {
	id: string;
	name: string;
	album_type?: string;
	release_date?: string;
	images?: SpotifyImage[];
	external_urls?: { spotify?: string };
}

export interface SpotifyTrack {
	id: string;
	name: string;
	duration_ms: number;
	explicit?: boolean;
	artists: SpotifyArtist[];
	album: SpotifyAlbum;
	external_urls?: { spotify?: string };
}

export interface SpotifyPlayItem {
	track: SpotifyTrack;
	played_at: string;
	context?: {
		type?: string;
		uri?: string;
	} | null;
}

export interface SpotifyRecentlyPlayedResponse {
	items: SpotifyPlayItem[];
	cursors?: {
		after?: string;
		before?: string;
	};
}

export interface SpotifyCurrentlyPlayingResponse {
	is_playing: boolean;
	progress_ms: number | null;
	item: SpotifyTrack | null;
	timestamp: number;
}

export interface PublicArtist {
	id: string;
	name: string;
}

export interface PublicTrack {
	id: string;
	name: string;
	artists: PublicArtist[];
	album: {
		id: string;
		name: string;
		artworkUrl: string | null;
	};
	durationMs: number;
	spotifyUrl: string | null;
}

export interface NormalizedPlay {
	track: SpotifyTrack;
	playedAt: string;
	playedAtUnixMs: number;
	contextType: string | null;
	contextUri: string | null;
}
