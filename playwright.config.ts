import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests/browser", timeout: 45000, workers: 1,
	outputDir: ".verification/browser",
	use: {
		baseURL: "http://127.0.0.1:8000",
		channel: process.platform === "win32" ? "msedge" : undefined,
		screenshot: "only-on-failure", trace: "retain-on-failure",
	},
	webServer: [
		{ command: "node tools/preview_listening_test.mjs", url: "http://127.0.0.1:8788/api/auth/session", timeout: 60000 },
		{ command: "node node_modules/astro/bin/astro.mjs dev --host 127.0.0.1 --port 8000", url: "http://127.0.0.1:8000/listening/", env: { ASTRO_DEV_BACKGROUND: "1", PUBLIC_SPOTIFY_API_BASE_URL: "http://127.0.0.1:8788" }, timeout: 60000 },
	],
});
