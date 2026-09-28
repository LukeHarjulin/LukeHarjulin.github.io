import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

function argument(name) {
	const index = process.argv.indexOf(name);
	if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing required argument ${name}.`);
	return process.argv[index + 1];
}

const databasePath = resolve(argument("--database"));
const planDirectory = resolve(argument("--plan-directory"));
const fingerprint = argument("--fingerprint");
const startChunk = Number(argument("--start-chunk"));
const endChunk = Number(argument("--end-chunk"));
if (!/^[a-f0-9]{64}$/iu.test(fingerprint)) throw new Error("The plan fingerprint is invalid.");
if (!Number.isInteger(startChunk) || !Number.isInteger(endChunk) || startChunk < 1 || endChunk < startChunk) {
	throw new Error("The local chunk range is invalid.");
}

const database = new DatabaseSync(databasePath);
try {
	database.exec("PRAGMA foreign_keys = ON");
	const persisted = database.prepare(
		"SELECT chunk_number FROM history_import_chunks WHERE plan_fingerprint = ?",
	).all(fingerprint);
	const completed = new Set(persisted.map((row) => Number(row.chunk_number)));
	let applied = 0;
	database.exec("BEGIN IMMEDIATE");
	try {
		for (let chunkNumber = startChunk; chunkNumber <= endChunk; chunkNumber += 1) {
			if (completed.has(chunkNumber)) continue;
			const filename = `chunk-${String(chunkNumber).padStart(6, "0")}.sql`;
			database.exec(await readFile(resolve(planDirectory, filename), "utf8"));
			applied += 1;
		}
		database.exec("COMMIT");
	} catch (error) {
		database.exec("ROLLBACK");
		throw error;
	}
	process.stdout.write(`${JSON.stringify({ applied })}\n`);
} finally {
	database.close();
}
