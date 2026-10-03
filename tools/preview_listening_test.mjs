// Synthetic local backend for browser tests. Never reads .dev.vars or remote D1.
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const workerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = workerRequire("miniflare");
const { build } = workerRequire("esbuild");
const bundle = await build({ entryPoints: ["workers/spotify-stats/src/index.ts"], bundle: true, format: "esm", write: false, platform: "browser" });
const mf = new Miniflare(convertV4MiniflareOptions({
	modules: true, script: bundle.outputFiles[0].text, port: 8788, host: "127.0.0.1",
	compatibilityDate: "2026-08-27", d1Databases: ["DB"],
	outboundService: async (request) => {
		if (request.url === "https://accounts.spotify.com/api/token") return Response.json({ access_token: "synthetic-access-token", expires_in: 3600 });
		if (request.url === "https://api.spotify.com/v1/me/player/currently-playing") return new Response(null, { status: 204 });
		return new Response("Unexpected test upstream request", { status: 503 });
	},
	bindings: {
		PUBLIC_SITE_ORIGIN: "http://127.0.0.1:8000", LISTENING_LOCAL_HTTP: "true",
		LISTENING_PASSPHRASE: "test listening phrase", LISTENING_SESSION_SECRET: "synthetic-test-secret-not-for-production",
		RECOMMENDATIONS_ENABLED: "false",
	},
	ratelimits: { LOGIN_RATE_LIMITER: { namespace_id: "1001", simple: { limit: 5, period: 60 } } },
}));
const db = await mf.getD1Database("DB");
for (const file of (await readdir("workers/spotify-stats/migrations")).filter((file) => file.endsWith(".sql")).sort()) {
	const sql = await readFile(`workers/spotify-stats/migrations/${file}`, "utf8");
	await db.exec(sql.split("\n").filter((line) => !line.trim().startsWith("--")).join(" "));
}
console.log(`Synthetic listening API ready at ${await mf.ready}`);
for (const event of ["SIGINT", "SIGTERM"]) process.on(event, async () => { await mf.dispose(); process.exit(0); });
