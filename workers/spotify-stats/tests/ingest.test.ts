import { describe, expect, it } from "vitest";
import { deduplicatePlays, normalizePlay } from "../src/ingest";
import type { SpotifyPlayItem } from "../src/types";

function play(trackId: string, playedAt: string): SpotifyPlayItem {
	return {
		played_at: playedAt,
		context: { type: "playlist", uri: "spotify:playlist:test" },
		track: {
			id: trackId,
			name: "Test track",
			duration_ms: 180000,
			artists: [{ id: "artist-1", name: "Test artist" }],
			album: { id: "album-1", name: "Test album" },
		},
	};
}

describe("recent play normalization", () => {
	it("normalizes timestamps and context", () => {
		const normalized = normalizePlay(play("track-1", "2026-08-27T10:00:00.000Z"));
		expect(normalized).toMatchObject({
			playedAt: "2026-08-27T10:00:00.000Z",
			contextType: "playlist",
			contextUri: "spotify:playlist:test",
		});
	});

	it("rejects unusable records", () => {
		expect(normalizePlay(play("track-1", "not-a-date"))).toBeNull();
	});

	it("deduplicates on track id and played-at timestamp", () => {
		const first = normalizePlay(play("track-1", "2026-08-27T10:00:00.000Z"))!;
		const duplicate = normalizePlay(play("track-1", "2026-08-27T10:00:00.000Z"))!;
		const repeatedLater = normalizePlay(play("track-1", "2026-08-27T10:03:00.000Z"))!;
		expect(deduplicatePlays([repeatedLater, first, duplicate])).toEqual([first, repeatedLater]);
	});
});
