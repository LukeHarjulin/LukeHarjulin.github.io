import { describe, expect, it } from "vitest";
import {
	activityPeriodStart,
	groupActivityByReportingDate,
	parseActivityPeriod,
	parseLimit,
	parseRankingPeriod,
	parseSummaryPeriod,
	periodStart,
	reportingDate,
} from "../src/periods";

describe("period parsing", () => {
	it("uses documented defaults", () => {
		expect(parseSummaryPeriod(null)).toBe("month");
		expect(parseRankingPeriod(null)).toBe("7d");
		expect(parseActivityPeriod(null)).toBe("year");
	});

	it("rejects unsupported periods", () => {
		expect(parseSummaryPeriod("7d")).toBeNull();
		expect(parseRankingPeriod("today")).toBeNull();
		expect(parseActivityPeriod("month")).toBeNull();
	});

	it("uses rolling UTC instants for day-count rankings", () => {
		const now = new Date("2026-08-27T12:00:00.000Z");
		expect(periodStart("7d", now)).toBe("2026-08-20T12:00:00.000Z");
		expect(periodStart("all", now)).toBeNull();
	});

	it("uses London midnight for winter and summer boundaries", () => {
		expect(periodStart("today", new Date("2026-01-15T12:00:00.000Z")))
			.toBe("2026-01-15T00:00:00.000Z");
		expect(periodStart("today", new Date("2026-07-15T12:00:00.000Z")))
			.toBe("2026-07-14T23:00:00.000Z");
		expect(periodStart("month", new Date("2026-08-27T12:00:00.000Z")))
			.toBe("2026-07-31T23:00:00.000Z");
		expect(periodStart("year", new Date("2026-08-27T12:00:00.000Z")))
			.toBe("2026-01-01T00:00:00.000Z");
	});

	it("starts activity year at London midnight 364 calendar dates before today", () => {
		expect(activityPeriodStart("year", new Date("2026-08-27T12:00:00.000Z")))
			.toBe("2025-08-27T23:00:00.000Z");
		expect(activityPeriodStart("all", new Date("2026-08-27T12:00:00.000Z"))).toBeNull();
	});

	it("keeps 365 inclusive London dates across the spring DST transition", () => {
		expect(activityPeriodStart("year", new Date("2026-03-30T00:30:00.000Z")))
			.toBe("2025-03-30T23:00:00.000Z");
		expect(reportingDate("2025-03-30T23:00:00.000Z")).toBe("2025-03-31");
		expect(reportingDate("2026-03-30T00:30:00.000Z")).toBe("2026-03-30");
	});

	it("keeps 30 inclusive London dates across the autumn DST transition", () => {
		expect(activityPeriodStart("30d", new Date("2026-10-26T12:00:00.000Z")))
			.toBe("2026-09-26T23:00:00.000Z");
		expect(reportingDate("2026-09-26T23:00:00.000Z")).toBe("2026-09-27");
		expect(reportingDate("2026-10-26T12:00:00.000Z")).toBe("2026-10-26");
	});

	it("maps heatmap dates across BST midnight and DST fallback", () => {
		expect(reportingDate("2026-07-14T22:59:59.999Z")).toBe("2026-07-14");
		expect(reportingDate("2026-07-14T23:00:00.000Z")).toBe("2026-07-15");
		expect(reportingDate("2026-10-25T00:30:00.000Z")).toBe("2026-10-25");
		expect(reportingDate("2026-10-25T01:30:00.000Z")).toBe("2026-10-25");
	});

	it("groups heatmap plays by London date and sums track durations", () => {
		expect(groupActivityByReportingDate([
			{ playedAt: "2026-07-14T22:59:59.999Z", durationMs: 100000 },
			{ playedAt: "2026-07-14T23:00:00.000Z", durationMs: 180000 },
			{ playedAt: "2026-07-15T08:00:00.000Z", durationMs: 200000 },
		])).toEqual([
			{ date: "2026-07-14", plays: 1, listeningTimeMs: 100000 },
			{ date: "2026-07-15", plays: 2, listeningTimeMs: 380000 },
		]);
	});
});

describe("limit parsing", () => {
	it("accepts integer values within the endpoint cap", () => {
		expect(parseLimit(null, 10, 50)).toBe(10);
		expect(parseLimit("50", 10, 50)).toBe(50);
	});

	it("rejects malformed and out-of-range values", () => {
		expect(parseLimit("0", 10, 50)).toBeNull();
		expect(parseLimit("51", 10, 50)).toBeNull();
		expect(parseLimit("1.5", 10, 50)).toBeNull();
	});
});
