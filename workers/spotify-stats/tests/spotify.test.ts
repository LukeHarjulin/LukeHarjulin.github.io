import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/runtime";
import { getCurrentlyPlaying, getRecentlyPlayed, toPublicTrack } from "../src/spotify";
import type { SpotifyTrack } from "../src/types";

const track: SpotifyTrack = {
	id: "track-1",
	name: "Test track",
	duration_ms: 180000,
	artists: [{ id: "artist-1", name: "Test artist" }],
	album: {
		id: "album-1",
		name: "Test album",
		images: [{ url: "https://images.example/art.jpg" }],
	},
	external_urls: { spotify: "https://open.spotify.com/track/track-1" },
};

const env = {
	SPOTIFY_CLIENT_ID: "client-id",
	SPOTIFY_CLIENT_SECRET: "client-secret",
	SPOTIFY_REFRESH_TOKEN: "refresh-token",
} as Env;

describe("Spotify client", () => {
	it("maps only public track fields", () => {
		expect(toPublicTrack(track)).toEqual({
			id: "track-1",
			name: "Test track",
			artists: [{ id: "artist-1", name: "Test artist" }],
			album: {
				id: "album-1",
				name: "Test album",
				artworkUrl: "https://images.example/art.jpg",
			},
			durationMs: 180000,
			spotifyUrl: "https://open.spotify.com/track/track-1",
		});
	});

	it("refreshes the token before requesting recent plays", async () => {
		const fetcher = vi.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ access_token: "access-token" }))
			.mockResolvedValueOnce(Response.json({ items: [] }));

		await getRecentlyPlayed(env, 1234, fetcher);

		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(String(fetcher.mock.calls[1][0])).toContain("after=1234");
		expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("Authorization")).toBe("Bearer access-token");
	});

	it("treats a 204 currently-playing response as idle", async () => {
		const fetcher = vi.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ access_token: "access-token" }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));

		await expect(getCurrentlyPlaying(env, fetcher)).resolves.toBeNull();
	});
});
