import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("local history plan executor", () => {
	it("applies missing chunks transactionally and skips their persisted markers on rerun", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "spotify-local-apply-"));
		temporaryDirectories.push(root);
		const databasePath = resolve(root, "history.sqlite");
		const planDirectory = resolve(root, "plan");
		const fingerprint = "a".repeat(64);
		await mkdir(planDirectory);
		const database = new DatabaseSync(databasePath);
		database.exec(`
			CREATE TABLE applied_values (value INTEGER PRIMARY KEY);
			CREATE TABLE history_import_chunks (
				plan_fingerprint TEXT NOT NULL,
				chunk_number INTEGER NOT NULL,
				chunk_checksum TEXT NOT NULL,
				expected_records INTEGER NOT NULL,
				PRIMARY KEY (plan_fingerprint, chunk_number)
			);
		`);
		database.close();
		for (const chunkNumber of [1, 2]) {
			await writeFile(resolve(planDirectory, `chunk-${String(chunkNumber).padStart(6, "0")}.sql`), `
				INSERT INTO applied_values (value) VALUES (${chunkNumber});
				INSERT INTO history_import_chunks VALUES ('${fingerprint}', ${chunkNumber}, '${String(chunkNumber).repeat(64)}', 1);
			`, "utf8");
		}

		const helper = resolve(process.cwd(), "tools", "apply_spotify_history_local.mjs");
		const args = [helper, "--database", databasePath, "--plan-directory", planDirectory,
			"--fingerprint", fingerprint, "--start-chunk", "1", "--end-chunk", "2"];
		const first = JSON.parse((await execFileAsync(process.execPath, args)).stdout);
		const second = JSON.parse((await execFileAsync(process.execPath, args)).stdout);

		expect(first).toEqual({ applied: 2 });
		expect(second).toEqual({ applied: 0 });
		const verification = new DatabaseSync(databasePath, { readOnly: true });
		expect(verification.prepare("SELECT COUNT(*) AS count FROM applied_values").get()).toEqual({ count: 2 });
		expect(verification.prepare("SELECT COUNT(*) AS count FROM history_import_chunks").get()).toEqual({ count: 2 });
		verification.close();
		expect(await readFile(resolve(planDirectory, "chunk-000001.sql"), "utf8").then(Boolean)).toBe(true);
	});

	it("rolls back the batch when a chunk violates a foreign key", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "spotify-local-fk-"));
		temporaryDirectories.push(root);
		const databasePath = resolve(root, "history.sqlite");
		const planDirectory = resolve(root, "plan");
		const fingerprint = "b".repeat(64);
		await mkdir(planDirectory);
		const database = new DatabaseSync(databasePath);
		database.exec(`
			CREATE TABLE parents (id INTEGER PRIMARY KEY);
			CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id));
			CREATE TABLE history_import_chunks (
				plan_fingerprint TEXT NOT NULL,
				chunk_number INTEGER NOT NULL,
				chunk_checksum TEXT NOT NULL,
				expected_records INTEGER NOT NULL,
				PRIMARY KEY (plan_fingerprint, chunk_number)
			);
		`);
		database.close();
		await writeFile(resolve(planDirectory, "chunk-000001.sql"), `
			INSERT INTO children (id, parent_id) VALUES (1, 999);
			INSERT INTO history_import_chunks VALUES ('${fingerprint}', 1, '${"c".repeat(64)}', 1);
		`, "utf8");

		const helper = resolve(process.cwd(), "tools", "apply_spotify_history_local.mjs");
		const args = [helper, "--database", databasePath, "--plan-directory", planDirectory,
			"--fingerprint", fingerprint, "--start-chunk", "1", "--end-chunk", "1"];
		await expect(execFileAsync(process.execPath, args)).rejects.toThrow();
		const verification = new DatabaseSync(databasePath, { readOnly: true });
		expect(verification.prepare("SELECT COUNT(*) AS count FROM children").get()).toEqual({ count: 0 });
		expect(verification.prepare("SELECT COUNT(*) AS count FROM history_import_chunks").get()).toEqual({ count: 0 });
		verification.close();
	});
});
