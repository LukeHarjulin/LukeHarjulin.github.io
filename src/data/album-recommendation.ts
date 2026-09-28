export type RecommendationKind = "rediscovery" | "exploration" | "discovery";

export interface AlbumRecommendation {
	id: string;
	name: string;
	artist: string;
	artworkUrl: string | null;
	spotifyUrl: string;
	kind: RecommendationKind;
	reason: string;
}

export interface AlbumRecommendations {
	date: string;
	generatedAt: string | null;
	stale: boolean;
	items: AlbumRecommendation[];
}
