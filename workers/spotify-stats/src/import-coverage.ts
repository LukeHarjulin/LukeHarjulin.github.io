import { calendarRange } from "./periods";
import type { D1Database } from "./runtime";

export type ImportCoverage = "incomplete" | "imported" | "live" | "unverified";

export async function getImportCoverage(db: D1Database, year: number, month: number | null) {
	const periods = (month === null ? [0, ...Array.from({ length: 12 }, (_, i) => i + 1)] : [month])
		.map((month) => ({ month, ...calendarRange(year, month || null) }));
	const result = await db.prepare(`
		WITH periods(month, start, end) AS (VALUES ${periods.map(() => "(?, ?, ?)").join(", ")}),
		live AS (SELECT played_at AS start FROM plays WHERE source = 'spotify_api' ORDER BY played_at LIMIT 1)
		SELECT p.month,
			MAX(CASE WHEN h.status IN ('pending', 'running', 'failed') THEN 1 ELSE 0 END) AS incomplete,
			MAX(CASE WHEN h.status = 'completed' THEN 1 ELSE 0 END) AS imported,
			CASE WHEN p.start >= (SELECT start FROM live) THEN 1 ELSE 0 END AS live
		FROM periods p LEFT JOIN history_imports h
			ON h.earliest_ended_at < p.end AND h.latest_ended_at >= p.start
		GROUP BY p.month
	`).bind(...periods.flatMap(({ month, start, end }) => [month, start, end]))
		.all<{ month: number; incomplete: number; imported: number; live: number }>();
	return new Map((result.results ?? []).map((entry) => [entry.month,
		(entry.incomplete ? "incomplete" : entry.imported ? "imported" : entry.live ? "live" : "unverified") as ImportCoverage,
	]));
}
