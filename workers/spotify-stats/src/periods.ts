export type SummaryPeriod = "today" | "month" | "year" | "all";
export type RankingPeriod = "7d" | "30d" | "year" | "all";
export type ActivityPeriod = "30d" | "year" | "all";

export const REPORTING_TIME_ZONE = "Europe/London";
const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
	timeZone: REPORTING_TIME_ZONE,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23",
});

interface DateParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

export interface ActivityPlay {
	playedAt: string;
	durationMs: number;
}

function partsInReportingTimeZone(date: Date): DateParts {
	const values = Object.fromEntries(
		dateFormatter.formatToParts(date)
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, Number(part.value)]),
	) as Record<keyof DateParts, number>;
	return values;
}

function reportingMidnightUtc(year: number, month: number, day: number): Date {
	const localAsUtc = Date.UTC(year, month - 1, day);
	let candidate = localAsUtc;

	for (let attempts = 0; attempts < 3; attempts += 1) {
		const parts = partsInReportingTimeZone(new Date(candidate));
		const representedAsUtc = Date.UTC(
			parts.year,
			parts.month - 1,
			parts.day,
			parts.hour,
			parts.minute,
			parts.second,
		);
		const adjustment = representedAsUtc - localAsUtc;
		if (adjustment === 0) {
			break;
		}
		candidate -= adjustment;
	}

	return new Date(candidate);
}

export function parseSummaryPeriod(value: string | null): SummaryPeriod | null {
	const period = value ?? "month";
	return ["today", "month", "year", "all"].includes(period) ? period as SummaryPeriod : null;
}

export function parseRankingPeriod(value: string | null): RankingPeriod | null {
	const period = value ?? "7d";
	return ["7d", "30d", "year", "all"].includes(period) ? period as RankingPeriod : null;
}

export function parseActivityPeriod(value: string | null): ActivityPeriod | null {
	const period = value ?? "year";
	return ["30d", "year", "all"].includes(period) ? period as ActivityPeriod : null;
}

export function periodStart(
	period: SummaryPeriod | RankingPeriod,
	now = new Date(),
): string | null {
	if (period === "all") {
		return null;
	}
	if (period === "7d" || period === "30d") {
		const days = period === "7d" ? 7 : 30;
		return new Date(now.getTime() - days * DAY_MS).toISOString();
	}

	const parts = partsInReportingTimeZone(now);
	if (period === "today") {
		return reportingMidnightUtc(parts.year, parts.month, parts.day).toISOString();
	}
	if (period === "month") {
		return reportingMidnightUtc(parts.year, parts.month, 1).toISOString();
	}
	return reportingMidnightUtc(parts.year, 1, 1).toISOString();
}

export function activityPeriodStart(period: ActivityPeriod, now = new Date()): string | null {
	if (period === "all") {
		return null;
	}

	const today = partsInReportingTimeZone(now);
	const daysBeforeToday = period === "year" ? 364 : 29;
	const targetDate = new Date(Date.UTC(today.year, today.month - 1, today.day - daysBeforeToday));
	return reportingMidnightUtc(
		targetDate.getUTCFullYear(),
		targetDate.getUTCMonth() + 1,
		targetDate.getUTCDate(),
	).toISOString();
}

export function reportingDate(instant: string | Date): string {
	const parts = partsInReportingTimeZone(typeof instant === "string" ? new Date(instant) : instant);
	return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function groupActivityByReportingDate(plays: ActivityPlay[]) {
	const grouped = new Map<string, { date: string; plays: number; listeningTimeMs: number }>();
	for (const play of plays) {
		const date = reportingDate(play.playedAt);
		const existing = grouped.get(date) ?? { date, plays: 0, listeningTimeMs: 0 };
		existing.plays += 1;
		existing.listeningTimeMs += play.durationMs;
		grouped.set(date, existing);
	}
	return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function parseLimit(value: string | null, defaultValue: number, maximum: number): number | null {
	if (value === null) {
		return defaultValue;
	}

	if (!/^\d+$/.test(value)) {
		return null;
	}

	const parsed = Number(value);
	return parsed >= 1 && parsed <= maximum ? parsed : null;
}
