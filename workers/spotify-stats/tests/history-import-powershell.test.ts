import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("Spotify history PowerShell guards", () => {
	it("rejects target, budget, and persisted-marker mismatches", async () => {
		const script = resolve(process.cwd(), "tools/test_spotify_history_import.ps1");
		const { stdout } = await execFileAsync("pwsh", ["-NoProfile", "-File", script]);
		expect(stdout).toContain("Spotify history import helper tests passed.");
	});
});
