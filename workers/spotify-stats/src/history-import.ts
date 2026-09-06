import type { SpotifyTrack } from "./types";

export type HistoryExclusionReason =
	| "duplicate"
	| "duplicate_track_timestamp"
	| "invalid_record"
	| "invalid_timestamp"
	| "invalid_track_uri"
	| "missing_track_uri"
	| "non_positive_duration"
	| "outside_live_cutoff"
	| "private_session"
	| "unsupported_media";

export interface ImportedHistoryPlay {
	eventKey: string;
	trackId: string;
	trackUri: string;
	trackName: string | null;
	albumName: string | null;
	artistName: string | null;
	endedAt: string;
	endedAtUnixMs: number;
	listenedMs: number;
}

export interface ParsedHistory {
	plays: ImportedHistoryPlay[];
	totalRecords: number;
	excluded: Record<HistoryExclusionReason, number>;
}

export interface MetadataEnrichmentResult {
	tracks: Map<string, SpotifyTrack>;
	unavailableTrackIds: string[];
}

export interface HistoryTrackMetadata {
	trackId: string;
	trackName: string;
	historyArtistName: string | null;
	historyAlbumName: string | null;
	catalogTrack: SpotifyTrack | null;
}

export interface HistoryImportSqlPlan {
	initializeSql: string;
	chunkSql: string[];
	chunkChecksums: string[];
	chunkExpectedRecords: number[];
	chunkEstimatedRowsWritten: number[];
	auditSql: string;
	importedRecords: number;
	skippedRecords: number;
	estimatedRowsWritten: number;
	earliestEndedAt: string | null;
	latestEndedAt: string | null;
}

const TRACK_URI_PATTERN = /^spotify:track:([A-Za-z0-9]{22})$/;
const SQL_STATEMENT_LIMIT_BYTES = 100_000;

const EMPTY_EXCLUSIONS: Record<HistoryExclusionReason, number> = {
	duplicate: 0,
	duplicate_track_timestamp: 0,
	invalid_record: 0,
	invalid_timestamp: 0,
	invalid_track_uri: 0,
	missing_track_uri: 0,
	non_positive_duration: 0,
	outside_live_cutoff: 0,
	private_session: 0,
	unsupported_media: 0,
};

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
	for (const key of keys) {
		if (record[key] !== undefined && record[key] !== null) return record[key];
	}
	return undefined;
}

function optionalString(record: Record<string, unknown>, keys: string[]): string | null {
	const value = firstValue(record, keys);
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isTrue(value: unknown): boolean {
	return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

function increment(
	excluded: Record<HistoryExclusionReason, number>,
	reason: HistoryExclusionReason,
): void {
	excluded[reason] += 1;
}

export function isStreamingHistoryPayload(value: unknown): value is unknown[] {
	if (!Array.isArray(value)) return false;
	return value.some((item) => {
		const record = asRecord(item);
		return record !== null && (
			"ts" in record
			|| "endTime" in record
			|| "ms_played" in record
			|| "msPlayed" in record
		);
	});
}

export async function sha256Hex(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function parseHistoryRecords(
	items: unknown[],
	cutoff: string | number,
): Promise<ParsedHistory> {
	const cutoffMs = typeof cutoff === "number" ? cutoff : Date.parse(cutoff);
	if (!Number.isFinite(cutoffMs)) throw new Error("The live-history cutoff is invalid.");

	const excluded = { ...EMPTY_EXCLUSIONS };
	const playsByTrackTimestamp = new Map<string, ImportedHistoryPlay>();

	for (const item of items) {
		const record = asRecord(item);
		if (!record) {
			increment(excluded, "invalid_record");
			continue;
		}

		if (optionalString(record, ["spotify_episode_uri", "spotifyEpisodeUri"])) {
			increment(excluded, "unsupported_media");
			continue;
		}

		if (isTrue(firstValue(record, ["incognito_mode", "incognitoMode", "private_session"]))) {
			increment(excluded, "private_session");
			continue;
		}

		const uri = optionalString(record, ["spotify_track_uri", "spotifyTrackUri"]);
		if (!uri) {
			increment(excluded, "missing_track_uri");
			continue;
		}

		const match = TRACK_URI_PATTERN.exec(uri);
		if (!match) {
			increment(excluded, "invalid_track_uri");
			continue;
		}

		const listenedValue = firstValue(record, ["ms_played", "msPlayed"]);
		const listenedMs = typeof listenedValue === "number"
			? listenedValue
			: Number(listenedValue);
		if (!Number.isSafeInteger(listenedMs) || listenedMs <= 0) {
			increment(excluded, "non_positive_duration");
			continue;
		}

		const endedValue = firstValue(record, ["ts", "endTime"]);
		const endedMs = typeof endedValue === "string" ? Date.parse(endedValue) : Number.NaN;
		if (!Number.isFinite(endedMs)) {
			increment(excluded, "invalid_timestamp");
			continue;
		}
		if (endedMs >= cutoffMs) {
			increment(excluded, "outside_live_cutoff");
			continue;
		}

		const endedAt = new Date(endedMs).toISOString();
		const timestampKey = `${match[1]}\u0000${endedAt}`;
		const previous = playsByTrackTimestamp.get(timestampKey);
		if (previous) {
			if (previous.listenedMs === listenedMs) increment(excluded, "duplicate");
			else increment(excluded, "duplicate_track_timestamp");
			if (previous.listenedMs >= listenedMs) continue;
		}

		const eventKey = await sha256Hex(`${uri}\u0000${endedAt}\u0000${listenedMs}`);
		playsByTrackTimestamp.set(timestampKey, {
			eventKey,
			trackId: match[1],
			trackUri: uri,
			trackName: optionalString(record, ["master_metadata_track_name", "masterMetadataTrackName", "trackName"]),
			albumName: optionalString(record, ["master_metadata_album_album_name", "masterMetadataAlbumAlbumName", "albumName"]),
			artistName: optionalString(record, ["master_metadata_album_artist_name", "masterMetadataAlbumArtistName", "artistName"]),
			endedAt,
			endedAtUnixMs: endedMs,
			listenedMs,
		});
	}

	return {
		plays: [...playsByTrackTimestamp.values()].sort((a, b) =>
			a.endedAtUnixMs - b.endedAtUnixMs || a.eventKey.localeCompare(b.eventKey)),
		totalRecords: items.length,
		excluded,
	};
}

export async function fetchSpotifyTrackWithRetry(
	trackId: string,
	accessToken: string,
	options: {
		fetcher?: typeof fetch;
		sleep?: (milliseconds: number) => Promise<void>;
		maxRetries?: number;
	} = {},
): Promise<SpotifyTrack | null> {
	const fetcher = options.fetcher ?? fetch;
	const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
	const maxRetries = options.maxRetries ?? 5;

	for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
		const response = await fetcher(`https://api.spotify.com/v1/tracks/${encodeURIComponent(trackId)}`, {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (response.ok) return response.json() as Promise<SpotifyTrack>;
		if (response.status === 404) return null;

		const retryable = response.status === 429 || response.status >= 500;
		if (!retryable || attempt === maxRetries) {
			throw new Error(`Spotify track metadata request failed with status ${response.status}.`);
		}

		const retryAfterSeconds = Number(response.headers.get("Retry-After"));
		const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
			? retryAfterSeconds * 1000
			: Math.min(1000 * 2 ** attempt, 30_000);
		await sleep(delay);
	}

	throw new Error("Spotify track metadata retry loop ended unexpectedly.");
}

export async function enrichTrackMetadata(
	trackIds: string[],
	loader: (trackId: string) => Promise<SpotifyTrack | null>,
	cache: Map<string, SpotifyTrack | null> = new Map(),
	concurrency = 2,
): Promise<MetadataEnrichmentResult> {
	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
		throw new Error("Metadata concurrency must be between 1 and 8.");
	}

	const ids = [...new Set(trackIds)].sort();
	let nextIndex = 0;
	async function worker(): Promise<void> {
		while (nextIndex < ids.length) {
			const id = ids[nextIndex];
			nextIndex += 1;
			if (!cache.has(id)) cache.set(id, await loader(id));
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
	const tracks = new Map<string, SpotifyTrack>();
	const unavailableTrackIds: string[] = [];
	for (const id of ids) {
		const track = cache.get(id) ?? null;
		if (track) tracks.set(id, track);
		else unavailableTrackIds.push(id);
	}
	return { tracks, unavailableTrackIds };
}

function sqlText(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function sqlNullable(value: string | null | undefined): string {
	return value === null || value === undefined ? "NULL" : sqlText(value);
}

function assertStatementSize(statement: string): string {
	if (new TextEncoder().encode(statement).byteLength > SQL_STATEMENT_LIMIT_BYTES) {
		throw new Error("Generated SQL statement exceeds D1's 100 KB statement limit.");
	}
	return statement;
}

function metadataStatements(track: SpotifyTrack, resolved: HistoryTrackMetadata): string[] {
	const statements = [assertStatementSize(`INSERT INTO albums (
	spotify_album_id, name, album_type, release_date, artwork_url, spotify_url
) VALUES (
	${sqlText(track.album.id)}, ${sqlText(track.album.name)}, ${sqlNullable(track.album.album_type)},
	${sqlNullable(track.album.release_date)}, ${sqlNullable(track.album.images?.[0]?.url)},
	${sqlNullable(track.album.external_urls?.spotify)}
) ON CONFLICT (spotify_album_id) DO NOTHING;`)];

	for (const artist of track.artists) {
		statements.push(assertStatementSize(`INSERT INTO artists (spotify_artist_id, name, spotify_url)
VALUES (${sqlText(artist.id)}, ${sqlText(artist.name)}, ${sqlNullable(artist.external_urls?.spotify)})
ON CONFLICT (spotify_artist_id) DO NOTHING;`));
	}

	statements.push(assertStatementSize(`INSERT INTO tracks (
	spotify_track_id, spotify_album_id, name, duration_ms, explicit, spotify_url,
	history_artist_name, history_album_name
) VALUES (
	${sqlText(track.id)}, ${sqlText(track.album.id)}, ${sqlText(track.name)},
	${Math.max(0, Math.trunc(track.duration_ms))}, ${track.explicit ? 1 : 0},
	${sqlNullable(track.external_urls?.spotify)}, ${sqlNullable(resolved.historyArtistName)},
	${sqlNullable(resolved.historyAlbumName)}
) ON CONFLICT (spotify_track_id) DO UPDATE SET
	history_artist_name = COALESCE(excluded.history_artist_name, tracks.history_artist_name),
	history_album_name = COALESCE(excluded.history_album_name, tracks.history_album_name),
	updated_at = CURRENT_TIMESTAMP;`));
	if (track.artists.length > 0) {
		const candidates = track.artists.map((artist, index) =>
			`SELECT ${sqlText(track.id)} AS spotify_track_id, ${sqlText(artist.id)} AS spotify_artist_id, ${index} AS artist_order`)
			.join("\n\tUNION ALL\n\t");
		statements.push(assertStatementSize(`INSERT INTO track_artists (spotify_track_id, spotify_artist_id, artist_order)
SELECT candidate.spotify_track_id, candidate.spotify_artist_id, candidate.artist_order
FROM (
	${candidates}
) candidate
WHERE NOT EXISTS (
	SELECT 1 FROM track_artists existing WHERE existing.spotify_track_id = ${sqlText(track.id)}
);`));
	}
	return statements;
}

export function resolveHistoryTrackMetadata(
	parsed: ParsedHistory,
	metadata: Map<string, SpotifyTrack>,
): Map<string, HistoryTrackMetadata> {
	const fallback = new Map<string, Omit<HistoryTrackMetadata, "trackName" | "catalogTrack"> & { trackName: string | null }>();
	for (const play of parsed.plays) {
		const previous = fallback.get(play.trackId);
		fallback.set(play.trackId, {
			trackId: play.trackId,
			trackName: play.trackName ?? previous?.trackName ?? null,
			historyArtistName: play.artistName ?? previous?.historyArtistName ?? null,
			historyAlbumName: play.albumName ?? previous?.historyAlbumName ?? null,
		});
	}

	return new Map([...fallback.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.flatMap(([trackId, names]) => {
			const catalogTrack = metadata.get(trackId) ?? null;
			const trackName = catalogTrack?.name ?? names.trackName;
			return trackName ? [[trackId, { ...names, trackName, catalogTrack }] as const] : [];
		}));
}

function resolvedMetadataStatements(resolved: HistoryTrackMetadata): string[] {
	if (resolved.catalogTrack) {
		const track = resolved.catalogTrack;
		return metadataStatements(track, resolved);
	}

	return [assertStatementSize(`INSERT INTO tracks (
	spotify_track_id, spotify_album_id, name, duration_ms, explicit, spotify_url,
	history_artist_name, history_album_name
) VALUES (
	${sqlText(resolved.trackId)}, NULL, ${sqlText(resolved.trackName)}, 0, 0, NULL,
	${sqlNullable(resolved.historyArtistName)}, ${sqlNullable(resolved.historyAlbumName)}
) ON CONFLICT (spotify_track_id) DO UPDATE SET
	history_artist_name = COALESCE(excluded.history_artist_name, tracks.history_artist_name),
	history_album_name = COALESCE(excluded.history_album_name, tracks.history_album_name),
	updated_at = CURRENT_TIMESTAMP;`)];
}

export async function generateHistoryImportSql(
	parsed: ParsedHistory,
	metadata: Map<string, SpotifyTrack>,
	options: {
		sourceChecksum: string;
		planFingerprint: string;
		cutoff: string;
		chunkSize?: number;
	},
): Promise<HistoryImportSqlPlan> {
	const chunkSize = options.chunkSize ?? 1000;
	if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 10_000) {
		throw new Error("SQL chunk size must be between 1 and 10000 plays.");
	}
	if (!/^[a-f0-9]{64}$/i.test(options.sourceChecksum)) {
		throw new Error("The source checksum must be a SHA-256 hexadecimal value.");
	}
	if (!/^[a-f0-9]{64}$/i.test(options.planFingerprint)) {
		throw new Error("The plan fingerprint must be a SHA-256 hexadecimal value.");
	}
	const cutoffMs = Date.parse(options.cutoff);
	if (!Number.isFinite(cutoffMs)) throw new Error("The plan cutoff is invalid.");
	const cutoff = new Date(cutoffMs).toISOString();

	const resolvedMetadata = resolveHistoryTrackMetadata(parsed, metadata);
	const importable = parsed.plays.filter((play) => resolvedMetadata.has(play.trackId));
	const unavailableCount = parsed.plays.length - importable.length;
	const chunkSql: string[] = [];
	const chunkChecksums: string[] = [];
	const chunkExpectedRecords: number[] = [];
	const chunkEstimatedRowsWritten: number[] = [];
	let estimatedRowsWritten = 6;
	const excludedCount = Object.values(parsed.excluded).reduce((total, count) => total + count, 0);
	const skippedRecords = excludedCount + unavailableCount;
	const earliestEndedAt = importable[0]?.endedAt ?? null;
	const latestEndedAt = importable[importable.length - 1]?.endedAt ?? null;
	const totalChunks = Math.ceil(importable.length / chunkSize);
	const initializeSql = `${assertStatementSize(`INSERT INTO history_imports (
	source, source_checksum, plan_fingerprint, cutoff_at, chunk_size, total_chunks,
	status, total_records, imported_records, skipped_records,
	earliest_ended_at, latest_ended_at, started_at
) VALUES (
	'spotify_extended_history', ${sqlText(options.sourceChecksum)}, ${sqlText(options.planFingerprint)},
	${sqlText(cutoff)}, ${chunkSize}, ${totalChunks}, 'running',
	${parsed.totalRecords}, ${importable.length}, ${skippedRecords},
	${sqlNullable(earliestEndedAt)}, ${sqlNullable(latestEndedAt)}, CURRENT_TIMESTAMP
) ON CONFLICT (plan_fingerprint) DO NOTHING;`)}\n`;

	for (let offset = 0; offset < importable.length; offset += chunkSize) {
		const chunk = importable.slice(offset, offset + chunkSize);
		const chunkNumber = chunkSql.length + 1;
		const statements: string[] = [];
		let estimatedChunkRowsWritten = 0;
		const trackIds = [...new Set(chunk.map((play) => play.trackId))].sort();
		for (const trackId of trackIds) {
			const track = resolvedMetadata.get(trackId);
			if (!track) continue;
			const trackStatements = resolvedMetadataStatements(track);
			statements.push(...trackStatements);
			// Includes table rows and known primary, unique, and explicit index maintenance.
			estimatedChunkRowsWritten += track.catalogTrack
				? 4 + track.catalogTrack.artists.length * 10
				: 2;
		}
		for (const play of chunk) {
			statements.push(assertStatementSize(`INSERT INTO plays (
	spotify_track_id, played_at, played_at_unix_ms, context_type, context_uri,
	source, source_event_key, listened_ms, source_ended_at
) VALUES (
	${sqlText(play.trackId)}, ${sqlText(play.endedAt)}, ${play.endedAtUnixMs}, NULL, NULL,
	'spotify_export', ${sqlText(play.eventKey)}, ${play.listenedMs}, ${sqlText(play.endedAt)}
) ON CONFLICT (spotify_track_id, played_at) DO UPDATE SET
	listened_ms = excluded.listened_ms,
	source_event_key = excluded.source_event_key,
	source_ended_at = excluded.source_ended_at
WHERE plays.source = 'spotify_export' AND excluded.listened_ms > plays.listened_ms;`));
			estimatedChunkRowsWritten += 5;
		}
		const dataSql = `${statements.join("\n\n")}\n`;
		const chunkChecksum = await sha256Hex(dataSql);
		statements.push(assertStatementSize(`INSERT INTO history_import_chunks (
	plan_fingerprint, chunk_number, chunk_checksum, expected_records
) VALUES (
	${sqlText(options.planFingerprint)}, ${chunkNumber}, ${sqlText(chunkChecksum)}, ${chunk.length}
) ON CONFLICT (plan_fingerprint, chunk_number) DO NOTHING;`));
		chunkSql.push(`${statements.join("\n\n")}\n`);
		chunkChecksums.push(chunkChecksum);
		chunkExpectedRecords.push(chunk.length);
		estimatedChunkRowsWritten += 3;
		chunkEstimatedRowsWritten.push(estimatedChunkRowsWritten);
		estimatedRowsWritten += estimatedChunkRowsWritten;
	}

	const auditSql = `${assertStatementSize(`UPDATE history_imports
SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE plan_fingerprint = ${sqlText(options.planFingerprint)}
	AND total_chunks = (
		SELECT COUNT(*)
		FROM history_import_chunks
		WHERE plan_fingerprint = ${sqlText(options.planFingerprint)}
	);`)}\n`;

	return {
		initializeSql,
		chunkSql,
		chunkChecksums,
		chunkExpectedRecords,
		chunkEstimatedRowsWritten,
		auditSql,
		importedRecords: importable.length,
		skippedRecords,
		estimatedRowsWritten,
		earliestEndedAt,
		latestEndedAt,
	};
}
