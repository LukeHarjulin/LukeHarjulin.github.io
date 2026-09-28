import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import process from "node:process";

import {
	enrichTrackMetadata,
	fetchSpotifyTrackWithRetry,
	generateHistoryImportSql,
	isStreamingHistoryPayload,
	parseHistoryRecords,
	resolveHistoryTrackMetadata,
} from "../workers/spotify-stats/src/history-import.ts";

function parseArguments(argv) {
	const values = new Map();
	const flags = new Set();
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
		if (argument === "--report-only") {
			flags.add(argument);
			continue;
		}
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
		values.set(argument, value);
		index += 1;
	}

	for (const required of ["--input", "--cutoff", "--workspace", "--dev-vars", "--result-file"]) {
		if (!values.has(required)) throw new Error(`Missing required argument ${required}.`);
	}
	return { values, flags };
}

async function atomicWrite(path, contents) {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.tmp`;
	await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
	await rename(temporaryPath, path);
}

async function findFiles(root) {
	const entries = await readdir(root, { withFileTypes: true });
	const files = [];
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) files.push(...await findFiles(path));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

async function sourceFiles(inputPath) {
	const resolvedInput = resolve(inputPath);
	try {
		const files = await findFiles(resolvedInput);
		return { root: resolvedInput, files };
	} catch (error) {
		if (error?.code !== "ENOTDIR") throw error;
		return { root: dirname(resolvedInput), files: [resolvedInput] };
	}
}

async function calculateSourceChecksum(root, files) {
	const hash = createHash("sha256");
	for (const path of files) {
		const name = relative(root, path).replaceAll("\\", "/") || basename(path);
		hash.update(name);
		hash.update("\0");
		hash.update(await readFile(path));
		hash.update("\0");
	}
	return hash.digest("hex");
}

function candidatePayloads(value) {
	if (isStreamingHistoryPayload(value)) return [value];
	if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
	return Object.values(value).filter(isStreamingHistoryPayload);
}

async function readHistory(root, files) {
	const records = [];
	const inputFiles = [];
	for (const path of files.filter((file) => file.toLowerCase().endsWith(".json"))) {
		let value;
		try {
			value = JSON.parse(await readFile(path, "utf8"));
		} catch (error) {
			throw new Error(`Could not parse JSON file ${path}: ${error.message}`);
		}
		const payloads = candidatePayloads(value);
		if (payloads.length === 0) continue;
		inputFiles.push(relative(root, path).replaceAll("\\", "/") || basename(path));
		for (const payload of payloads) records.push(...payload);
	}
	if (inputFiles.length === 0) {
		throw new Error("No Spotify streaming-history JSON payloads were found in the input.");
	}
	return { records, inputFiles };
}

function parseDevVars(text) {
	const values = new Map();
	for (const rawLine of text.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const separator = line.indexOf("=");
		if (separator < 1) continue;
		const key = line.slice(0, separator).trim();
		let value = line.slice(separator + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		values.set(key, value);
	}
	return values;
}

async function getAccessToken(devVarsPath) {
	const values = parseDevVars(await readFile(devVarsPath, "utf8"));
	const clientId = values.get("SPOTIFY_CLIENT_ID");
	const clientSecret = values.get("SPOTIFY_CLIENT_SECRET");
	const refreshToken = values.get("SPOTIFY_REFRESH_TOKEN");
	if (!clientId || !clientSecret || !refreshToken) {
		throw new Error(".dev.vars must contain SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REFRESH_TOKEN.");
	}

	const response = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: {
			Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
	});
	if (!response.ok) throw new Error(`Spotify token refresh failed with status ${response.status}.`);
	const payload = await response.json();
	if (typeof payload.access_token !== "string") throw new Error("Spotify token response did not contain an access token.");
	return payload.access_token;
}

async function loadCache(cachePath) {
	try {
		const payload = JSON.parse(await readFile(cachePath, "utf8"));
		if (payload?.version !== 1 || typeof payload.tracks !== "object" || payload.tracks === null) return new Map();
		return new Map(Object.entries(payload.tracks));
	} catch (error) {
		if (error?.code === "ENOENT") return new Map();
		throw error;
	}
}

async function writeCache(cachePath, cache) {
	const tracks = Object.fromEntries([...cache.entries()].sort(([left], [right]) => left.localeCompare(right)));
	await atomicWrite(cachePath, `${JSON.stringify({ version: 1, tracks }, null, "\t")}\n`);
}

function numericArgument(value, fallback, label, minimum, maximum) {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
	}
	return parsed;
}

async function main() {
	const { values, flags } = parseArguments(process.argv.slice(2));
	const inputPath = resolve(values.get("--input"));
	const workspace = resolve(values.get("--workspace"));
	const devVarsPath = resolve(values.get("--dev-vars"));
	const resultFile = resolve(values.get("--result-file"));
	const cutoff = new Date(values.get("--cutoff"));
	if (!Number.isFinite(cutoff.getTime())) throw new Error("The cutoff must be an ISO-8601 timestamp.");
	const chunkSize = numericArgument(values.get("--chunk-size"), 1000, "Chunk size", 1, 10_000);
	const concurrency = numericArgument(values.get("--metadata-concurrency"), 2, "Metadata concurrency", 1, 8);
	const metadataMode = values.get("--metadata-mode") ?? "cache-only";
	if (!["cache-only", "refresh"].includes(metadataMode)) {
		throw new Error("Metadata mode must be cache-only or refresh.");
	}

	const { root, files } = await sourceFiles(inputPath);
	const providedChecksum = values.get("--source-checksum");
	if (providedChecksum && !/^[a-f0-9]{64}$/iu.test(providedChecksum)) {
		throw new Error("The provided source checksum is not a SHA-256 hexadecimal value.");
	}
	const sourceChecksum = providedChecksum?.toLowerCase() ?? await calculateSourceChecksum(root, files);
	const { records, inputFiles } = await readHistory(root, files);
	const parsed = await parseHistoryRecords(records, cutoff.toISOString());
	const cachePath = resolve(workspace, "cache", "tracks.json");
	const cache = await loadCache(cachePath);
	const missingTrackIds = [...new Set(parsed.plays.map((play) => play.trackId))].filter((id) => !cache.has(id));
	let accessToken = metadataMode === "refresh" && missingTrackIds.length > 0 ? await getAccessToken(devVarsPath) : "";
	let cacheWriteQueue = Promise.resolve();
	const enrichment = metadataMode === "refresh"
		? await enrichTrackMetadata(
			parsed.plays.map((play) => play.trackId),
			async (trackId) => {
				let track;
				try {
					track = await fetchSpotifyTrackWithRetry(trackId, accessToken);
				} catch (error) {
					if (!String(error?.message).includes("status 401")) throw error;
					accessToken = await getAccessToken(devVarsPath);
					track = await fetchSpotifyTrackWithRetry(trackId, accessToken);
				}
				cache.set(trackId, track);
				cacheWriteQueue = cacheWriteQueue.then(() => writeCache(cachePath, cache));
				await cacheWriteQueue;
				return track;
			},
			cache,
			concurrency,
		)
		: {
			tracks: new Map([...cache.entries()].filter((entry) => entry[1] !== null)),
			unavailableTrackIds: [...new Set(parsed.plays.map((play) => play.trackId))]
				.filter((id) => !cache.get(id))
				.sort(),
		};
	await cacheWriteQueue;
	const resolvedMetadata = resolveHistoryTrackMetadata(parsed, enrichment.tracks);

	const planFingerprint = createHash("sha256")
		.update(sourceChecksum)
		.update("\0")
		.update(cutoff.toISOString())
		.update("\0")
		.update(String(chunkSize))
		.update("\0")
		.update("history-plan-v2")
		.update("\0")
		.update(parsed.plays
			.filter((play) => resolvedMetadata.has(play.trackId))
			.map((play) => play.eventKey)
			.sort()
			.join("\0"))
		.update("\0")
		.update(JSON.stringify([...resolvedMetadata.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([trackId, resolved]) => ({
				trackId,
				name: resolved.trackName,
				historyArtistName: resolved.historyArtistName,
				historyAlbumName: resolved.historyAlbumName,
				catalog: resolved.catalogTrack ? {
					durationMs: resolved.catalogTrack.duration_ms,
					explicit: resolved.catalogTrack.explicit ?? false,
					spotifyUrl: resolved.catalogTrack.external_urls?.spotify ?? null,
					album: {
						id: resolved.catalogTrack.album.id,
						name: resolved.catalogTrack.album.name,
						type: resolved.catalogTrack.album.album_type ?? null,
						releaseDate: resolved.catalogTrack.album.release_date ?? null,
						artworkUrl: resolved.catalogTrack.album.images?.[0]?.url ?? null,
						spotifyUrl: resolved.catalogTrack.album.external_urls?.spotify ?? null,
					},
					artists: resolved.catalogTrack.artists.map((artist) => ({
					id: artist.id,
					name: artist.name,
					spotifyUrl: artist.external_urls?.spotify ?? null,
					})),
				} : null,
			}))))
		.digest("hex");
	const plan = await generateHistoryImportSql(parsed, enrichment.tracks, {
		sourceChecksum,
		planFingerprint,
		cutoff: cutoff.toISOString(),
		chunkSize,
	});
	const planKey = `${sourceChecksum.slice(0, 16)}-${planFingerprint.slice(0, 16)}-c${chunkSize}`;
	const planDirectory = resolve(workspace, "plans", planKey);
	const excludedRecords = Object.values(parsed.excluded).reduce((sum, count) => sum + count, 0);
	const unresolvedIds = new Set([...new Set(parsed.plays.map((play) => play.trackId))]
		.filter((trackId) => !resolvedMetadata.has(trackId)));
	const unresolvedPlayRecords = parsed.plays.filter((play) => unresolvedIds.has(play.trackId)).length;
	const unresolvedTracks = [...new Map(parsed.plays
		.filter((play) => unresolvedIds.has(play.trackId))
		.map((play) => [play.trackId, {
			trackId: play.trackId,
			trackName: play.trackName,
			artistName: play.artistName,
			albumName: play.albumName,
		}])).values()].sort((left, right) => left.trackId.localeCompare(right.trackId));
	const catalogTrackCount = [...resolvedMetadata.values()].filter((track) => track.catalogTrack !== null).length;
	const report = {
		version: 2,
		generatedAt: new Date().toISOString(),
		sourceChecksum,
		planFingerprint,
		cutoff: cutoff.toISOString(),
		inputFiles,
		totalRecords: parsed.totalRecords,
		candidateMusicRecords: parsed.plays.length,
		importableRecords: plan.importedRecords,
		skippedRecords: plan.skippedRecords,
		excludedRecords,
		exclusions: parsed.excluded,
		uniqueCandidateTracks: new Set(parsed.plays.map((play) => play.trackId)).size,
		metadataMode,
		catalogTrackCount,
		fallbackTrackCount: resolvedMetadata.size - catalogTrackCount,
		unresolvedTrackCount: unresolvedIds.size,
		unresolvedPlayRecords,
		unresolvedTracks,
		catalogMetadataMissingTrackCount: enrichment.unavailableTrackIds.length,
		earliestEndedAt: plan.earliestEndedAt,
		latestEndedAt: plan.latestEndedAt,
		chunkSize,
		chunkCount: plan.chunkSql.length,
		chunkEstimatedRowsWritten: plan.chunkEstimatedRowsWritten,
		estimatedRowsWritten: plan.estimatedRowsWritten,
	};

	await mkdir(planDirectory, { recursive: true });
	const reportPath = resolve(planDirectory, "report.json");
	await atomicWrite(reportPath, `${JSON.stringify(report, null, "\t")}\n`);
	let initializeFile = null;
	const chunkFiles = [];
	const chunks = [];
	let auditFile = null;
	if (!flags.has("--report-only")) {
		initializeFile = resolve(planDirectory, "initialize.sql");
		await atomicWrite(initializeFile, plan.initializeSql);
		for (let index = 0; index < plan.chunkSql.length; index += 1) {
			const path = resolve(planDirectory, `chunk-${String(index + 1).padStart(6, "0")}.sql`);
			await atomicWrite(path, plan.chunkSql[index]);
			chunkFiles.push(path);
			chunks.push({
				chunkNumber: index + 1,
				path,
				checksum: plan.chunkChecksums[index],
				expectedRecords: plan.chunkExpectedRecords[index],
				estimatedRowsWritten: plan.chunkEstimatedRowsWritten[index],
			});
		}
		auditFile = resolve(planDirectory, "audit.sql");
		await atomicWrite(auditFile, plan.auditSql);
	}

	const result = { planDirectory, reportPath, initializeFile, chunkFiles, chunks, auditFile, report };
	await atomicWrite(resultFile, `${JSON.stringify(result, null, "\t")}\n`);
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
