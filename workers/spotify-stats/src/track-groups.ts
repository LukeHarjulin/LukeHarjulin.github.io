import type { PublicTrack } from "./types";

// Only remove complete remaster annotations, never performance or mix labels.
const REMASTER = "(?:\\d{4}\\s+)?(?:digital(?:ly)?\\s+)?remaster(?:ed)?(?:\\s+\\d{4})?";
const REMASTER_SUFFIX = new RegExp(`(?:\\s*\\(${REMASTER}\\)|\\s*\\[${REMASTER}\\]|\\s+[-–—]\\s*${REMASTER})$`, "i");

export function songTitle(name: string): string {
	let title = name.normalize("NFKC").replace(/\s+/g, " ").trim();
	while (REMASTER_SUFFIX.test(title)) title = title.replace(REMASTER_SUFFIX, "").trim();
	return title || name;
}

export function songKey(track: PublicTrack, explicit: boolean): string {
	// Missing artist metadata is not enough evidence to combine recordings.
	if (!track.artists.length) return JSON.stringify(["track", track.id]);
	return JSON.stringify([
		songTitle(track.name).toLowerCase(),
		[...new Set(track.artists.map((artist) => artist.id))].sort(),
		explicit,
	]);
}

export function groupSongs<T extends { track: PublicTrack; explicit: boolean }>(rows: T[]): T[][] {
	const groups = new Map<string, T[]>();
	for (const row of rows) {
		const key = songKey(row.track, row.explicit);
		const group = groups.get(key);
		if (group) group.push(row);
		else groups.set(key, [row]);
	}
	return [...groups.values()];
}

export function representativeTrack(tracks: PublicTrack[]): PublicTrack {
	// Prefer an original title, then use the ID for a stable tie break.
	const sorted = [...tracks].sort((a, b) => (
		Number(songTitle(a.name) !== a.name) - Number(songTitle(b.name) !== b.name)
		|| a.id.localeCompare(b.id)
	));
	const track = sorted[0];
	return tracks.length === 1 ? track : {
		...track,
		name: songTitle(track.name),
		versionIds: sorted.map((version) => version.id),
	};
}
