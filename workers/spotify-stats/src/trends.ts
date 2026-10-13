import { calendarRange, EARLIEST_TRENDS_YEAR, REPORTING_TIME_ZONE, reportingDate } from "./periods";
import { getSummary, getTopArtists, getTopTracks } from "./repository";
import type { D1Database } from "./runtime";
import { getTasteTrends } from "./trend-taste";
import { getImportCoverage } from "./import-coverage";

interface MonthlyTotals {
	month: number;
	plays: number;
	listeningTimeMs: number;
	recordedTimeMs: number;
	estimatedTimeMs: number;
}

/** SQL receives London month boundaries; no individual play rows leave D1. */
async function getMonthlyTotals(db: D1Database, year: number, month: number | null): Promise<MonthlyTotals[]> {
	const ranges = (month === null ? Array.from({ length: 12 }, (_, index) => index + 1) : [month])
		.map((month) => ({ month, ...calendarRange(year, month) }));
	const result = await db.prepare(`
		WITH months(month, start, end) AS (VALUES ${ranges.map(() => "(?, ?, ?)").join(", ")})
		SELECT m.month, COUNT(p.id) AS plays,
			COALESCE(SUM(COALESCE(p.listened_ms, t.duration_ms)), 0) AS listeningTimeMs,
			COALESCE(SUM(p.listened_ms), 0) AS recordedTimeMs,
			COALESCE(SUM(CASE WHEN p.listened_ms IS NULL THEN t.duration_ms ELSE 0 END), 0) AS estimatedTimeMs
		FROM months m
		LEFT JOIN plays p ON p.played_at >= m.start AND p.played_at < m.end
		LEFT JOIN tracks t ON t.spotify_track_id = p.spotify_track_id
		GROUP BY m.month ORDER BY m.month
	`).bind(...ranges.flatMap(({ month, start, end }) => [month, start, end])).all<MonthlyTotals>();
	return result.results ?? [];
}

export async function getTrends(db: D1Database, year: number, month: number | null, now = new Date()) {
	const range = calendarRange(year, month);
	const currentDate = reportingDate(now);
	const currentYear = Number(currentDate.slice(0, 4));
	const currentMonth = Number(currentDate.slice(5, 7));
	const [totals, monthlyTotals, artists, tracks, earliest, taste, coverage] = await Promise.all([
		getSummary(db, range.start, range.end),
		getMonthlyTotals(db, year, month),
		getTopArtists(db, range.start, 10, { end: range.end, byListeningTime: true }),
		getTopTracks(db, range.start, 10, { end: range.end, byListeningTime: true }),
		db.prepare("SELECT played_at AS firstPlayed FROM plays ORDER BY played_at LIMIT 1").first<{ firstPlayed: string }>(),
		getTasteTrends(db, year, month),
		getImportCoverage(db, year, month),
	]);
	const firstYear = earliest?.firstPlayed ? Number(reportingDate(earliest.firstPlayed).slice(0, 4)) : currentYear;
	const oldestYear = Math.max(EARLIEST_TRENDS_YEAR, Math.min(currentYear, firstYear));
	return {
		year,
		month,
		importCoverage: coverage.get(month ?? 0) ?? "unverified",
		timeZone: REPORTING_TIME_ZONE,
		availableYears: Array.from({ length: currentYear - oldestYear + 1 }, (_, index) => currentYear - index),
		totals: {
			...(totals ?? { plays: 0, listeningTimeMs: 0, uniqueArtists: 0, uniqueTracks: 0 }),
			recordedTimeMs: monthlyTotals.reduce((sum, entry) => sum + entry.recordedTimeMs, 0),
			estimatedTimeMs: monthlyTotals.reduce((sum, entry) => sum + entry.estimatedTimeMs, 0),
		},
		isToDate: year === currentYear && (month === null || month === currentMonth),
		isUpcoming: year === currentYear && month !== null && month > currentMonth,
		// The frontend retains the annual chart while fetching monthly detail.
		// Empty buckets are not proof of complete historical coverage.
		...(month === null ? { months: monthlyTotals.map((entry) => ({
			...entry,
			importCoverage: coverage.get(entry.month) ?? "unverified",
			...(taste.months.get(entry.month) ?? { topArtist: null, topGenre: null }),
			isToDate: year === currentYear && entry.month === currentMonth,
			isUpcoming: year === currentYear && entry.month > currentMonth,
		})) } : {}),
		artists,
		tracks,
		...taste.period,
	};
}
