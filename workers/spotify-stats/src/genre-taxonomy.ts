export const GENRE_TAXONOMY_VERSION = 1;

// Exact allowlist: never infer genres from arbitrary words in community tags.
const names = [
	"rock", "pop", "metal", "heavy metal", "hard rock", "classic rock", "alternative rock",
	"indie rock", "progressive rock", "psychedelic rock", "punk", "punk rock", "post-punk",
	"grunge", "garage rock", "art rock", "folk rock", "soft rock", "glam rock", "glam metal",
	"doom metal", "death metal", "black metal", "thrash metal", "power metal", "progressive metal",
	"symphonic metal", "folk metal", "gothic metal", "alternative metal", "nu metal", "metalcore",
	"jazz", "blues", "soul", "funk", "r&b", "hip-hop", "rap", "country", "folk", "classical",
	"electronic", "dance", "house", "techno", "trance", "ambient", "drum and bass", "dubstep",
	"disco", "synthpop", "electropop", "indie pop", "dream pop", "shoegaze", "trip-hop",
	"reggae", "ska", "dub", "bluegrass", "gospel", "new wave", "industrial", "industrial metal",
	"post-rock", "post-metal", "hardcore punk", "emo", "pop punk", "pop rock", "southern rock",
	"stoner rock", "stoner metal", "speed metal", "singer-songwriter", "jazz fusion", "bossa nova",
];
const aliases = new Map(names.map((name) => [name, name]));
for (const [alias, genre] of Object.entries({
	"hip hop": "hip-hop", "hiphop": "hip-hop", "rnb": "r&b", "rhythm and blues": "r&b",
	"synth-pop": "synthpop", "nu-metal": "nu metal", "drum & bass": "drum and bass",
	"progressive-rock": "progressive rock", "trip hop": "trip-hop", "pop-punk": "pop punk",
})) aliases.set(alias, genre);

export function identityName(value: string): string {
	return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function lastfmGenres(value: unknown): { key: string; name: string }[] {
	if (!Array.isArray(value) || value.length > 1000) throw new Error("Invalid tags");
	const scores = new Map<string, number>();
	for (const item of value) {
		if (!item || typeof item.name !== "string" || !["number", "string"].includes(typeof item.count)
			|| String(item.count).trim() === "") throw new Error("Invalid tag");
		const score = Number(item.count);
		if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("Invalid tag strength");
		const genre = aliases.get(identityName(item.name));
		if (genre && score > 0) scores.set(genre, Math.max(scores.get(genre) ?? 0, score));
	}
	const sorted = [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	// Relative popularity, not listener counts or statistical confidence.
	return sorted.filter(([, score]) => score >= 10).slice(0, 3).map(([name]) => ({ key: name, name }));
}
