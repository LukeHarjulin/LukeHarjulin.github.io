import { test, expect, type Page } from "@playwright/test";

const api = "http://127.0.0.1:8788";
const currentYear = Number(new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "Europe/London" }).format(new Date()));
const currentMonth = Number(new Intl.DateTimeFormat("en-GB", { month: "numeric", timeZone: "Europe/London" }).format(new Date()));
const previousYear = currentYear - 1;

function fixture(year: number, month: number | null) {
	const series = Array.from({ length: 12 }, (_, index) => {
		const isUpcoming = year === currentYear && index + 1 > currentMonth;
		const empty = index === 1 || year === previousYear - 1 || isUpcoming;
		return { month: index + 1, plays: empty ? 0 : 3, listeningTimeMs: empty ? 0 : (index + 1) * 600000, isToDate: year === currentYear && index + 1 === currentMonth, isUpcoming };
	});
	const selected = month === null ? series : series.filter((entry) => entry.month === month);
	const plays = selected.reduce((sum, entry) => sum + entry.plays, 0);
	const listeningTimeMs = selected.reduce((sum, entry) => sum + entry.listeningTimeMs, 0);
	const empty = plays === 0;
	const totals = { plays, listeningTimeMs, uniqueArtists: empty ? 0 : 1, uniqueTracks: empty ? 0 : 1, recordedTimeMs: listeningTimeMs / 2, estimatedTimeMs: listeningTimeMs / 2 };
	return {
		data: {
			year, month, timeZone: "Europe/London", availableYears: [currentYear, previousYear, previousYear - 1], totals,
			isToDate: year === currentYear && (month === null || month === currentMonth), isUpcoming: year === currentYear && month !== null && month > currentMonth,
			...(month === null ? { months: series.map((entry) => ({ ...entry, topArtist: entry.plays > 0 ? { name: `Artist ${entry.month}` } : null, topGenre: entry.plays > 0 ? { name: entry.month % 2 ? "Rock" : "Jazz" } : null })) } : {}),
			genres: empty ? [] : [
				{ kind: "genre", name: "Rock", listeningTimeMs: listeningTimeMs * 0.5, sharePercent: 50 },
				{ kind: "other", name: "Other", listeningTimeMs: listeningTimeMs * 0.25, sharePercent: 25 },
				{ kind: "unknown", name: "Unknown", listeningTimeMs: listeningTimeMs * 0.25, sharePercent: 25 },
			],
			topGenre: empty ? null : { name: "Rock" },
			genreCoverage: { percentage: empty ? 0 : 75, identifiedTimeMs: listeningTimeMs * 0.75, totalTimeMs: listeningTimeMs },
			artists: empty ? [] : [{ id: "artist", name: `${month === null ? "Year" : "Month"} artist ${year}`, spotifyUrl: "https://open.spotify.com/artist/test", plays, listeningTimeMs }],
			tracks: empty ? [] : [{ track: { id: "track", name: "A favourite track", spotifyUrl: "javascript:alert(1)", artists: [{ name: "Artist" }] }, plays, listeningTimeMs }],
		}, meta: { generatedAt: new Date().toISOString(), period: month === null ? String(year) : `${year}-${String(month).padStart(2, "0")}` },
	};
}
async function mockAccess(page: Page) {
	await page.route(`${api}/api/auth/session`, (route) => route.fulfill({ json: { data: { authenticated: true, expiresAt: Date.now() + 604800000 }, meta: {} } }));
}
async function mockTrends(page: Page) {
	await page.route(`${api}/api/spotify/trends?*`, (route) => {
		const url = new URL(route.request().url());
		return route.fulfill({ json: fixture(Number(url.searchParams.get("year")), url.searchParams.has("month") ? Number(url.searchParams.get("month")) : null) });
	});
}

test("shares the existing session across listening and trends, with no trends requests before unlocking", async ({ page }, testInfo) => {
	const requests: string[] = [];
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("request", (request) => { if (request.url().includes("/api/spotify/")) requests.push(request.url()); });
	await mockTrends(page);
	await page.goto(`/listening/trends/?year=${previousYear}`);
	await expect(page.getByRole("button", { name: "Unlock", exact: true })).toBeEnabled();
	await expect(page.locator("#listening-dashboard")).toBeHidden();
	expect(requests).toEqual([]);
	await page.getByLabel("Shared passphrase").fill("test listening phrase");
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expect(page.getByRole("heading", { name: `Whole year · ${previousYear}` })).toBeVisible();
	await expect(page.locator("#trends-detail")).toHaveAttribute("aria-busy", "false");
	expect(requests.every((url) => url.includes("/trends?"))).toBe(true);
	await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
	await page.locator("#trends-heading").click();
	await page.screenshot({ path: testInfo.outputPath("trends-desktop.png"), fullPage: true });
	await page.getByRole("link", { name: "Back to listening", exact: true }).click();
	await expect(page.locator("#listening-dashboard")).toBeVisible();
	await expect(page.locator("#listening-access")).toBeHidden();
	await page.getByRole("link", { name: "Explore listening trends" }).click();
	await expect(page.locator("#trends-chart button")).toHaveCount(12);
	await expect(page.locator("#listening-access")).toBeHidden();
	await page.getByRole("button", { name: "Lock", exact: true }).click();
	await expect(page.locator("#listening-dashboard")).toBeHidden();
	await expect(page.locator("#listening-access-status")).toHaveText("Listening is locked.");
	expect(errors).toEqual([]);
});

test("year/month navigation, keyboard selection, URL restoration and mobile layout", async ({ page }, testInfo) => {
	const requests: string[] = [];
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("request", (request) => { if (request.url().includes("/api/spotify/")) requests.push(request.url()); });
	await mockAccess(page);
	await mockTrends(page);
	await page.goto(`/listening/trends/?year=${previousYear}`);
	await expect(page.locator("#trends-status")).toHaveText(`Showing ${previousYear}.`);
	await expect(page.locator("#trends-chart button")).toHaveCount(12);
	await expect(page.locator("#trends-artists")).toContainText(`Year artist ${previousYear}`);
	await expect(page.locator("#trends-genre-coverage")).toContainText("75%");
	await expect(page.locator("#trends-genres")).toContainText("Unknown");
	await expect(page.locator("#trends-genres")).toContainText("Other");
	await expect(page.locator("#trends-highlights button")).toHaveCount(12);
	await expect(page.locator('#trends-highlights button[data-month="3"]')).toContainText("Artist 3");
	await expect(page.locator("#trends-tracks a")).toHaveCount(0);
	const march = page.getByRole("button", { name: new RegExp(`^March ${previousYear}:`) });
	await march.focus();
	await page.keyboard.press("Enter");
	await expect(page.locator("#trends-status")).toHaveText(`Showing March ${previousYear}.`);
	await expect(page).toHaveURL(new RegExp(`year=${previousYear}&month=3`));
	await expect(march).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator("#trends-artists")).toContainText(`Month artist ${previousYear}`);
	await page.reload();
	await expect(page.getByRole("heading", { name: `March ${previousYear}` })).toBeVisible();
	await expect(page.locator("#trends-detail")).toHaveAttribute("aria-busy", "false");
	await page.getByRole("button", { name: "Whole year", exact: true }).click();
	await expect(page.locator("#trends-status")).toHaveText(`Showing ${previousYear}.`);
	await page.getByRole("button", { name: `Explore April ${previousYear} favourites`, exact: true }).click();
	await expect(page.locator("#trends-status")).toHaveText(`Showing April ${previousYear}.`);
	await page.getByRole("button", { name: "Whole year", exact: true }).click();
	await expect(page.locator("#trends-status")).toHaveText(`Showing ${previousYear}.`);
	await page.goBack();
	await expect(page.locator("#trends-status")).toHaveText(`Showing April ${previousYear}.`);
	await page.goForward();
	await expect(page.locator("#trends-status")).toHaveText(`Showing ${previousYear}.`);
	await page.getByLabel("Year", { exact: true }).selectOption(String(previousYear - 1));
	await expect(page.getByRole("heading", { name: `Whole year · ${previousYear - 1}` })).toBeVisible();
	await expect(page.locator("#trends-empty")).toHaveText("No recorded plays for this period.");
	await page.getByLabel("Year", { exact: true }).selectOption(String(previousYear));
	await expect(page.locator("#trends-status")).toHaveText(`Showing ${previousYear}.`);
	await page.getByRole("button", { name: new RegExp(`^February ${previousYear}:`) }).click();
	await expect(page.locator("#trends-empty")).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
	await page.locator("#trends-heading").click();
	await page.screenshot({ path: testInfo.outputPath("trends-mobile.png"), fullPage: true });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.getByRole("button", { name: "Whole year", exact: true }).click();
	await expect(page.locator("#trends-status")).toHaveText(`Showing ${previousYear}.`);
	await page.screenshot({ path: testInfo.outputPath("trends-mobile-annual.png"), fullPage: true });
	await page.setViewportSize({ width: 320, height: 700 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	expect(requests.every((url) => url.includes("/trends?"))).toBe(true);
	expect(errors).toEqual([]);
});

test("normalizes invalid URLs, marks upcoming months, retries failures, and handles session expiry", async ({ page }) => {
	await mockAccess(page);
	await mockTrends(page);
	await page.goto("/listening/trends/?year=bad&month=13");
	await expect(page.locator("#trends-status")).toHaveText(`Showing ${currentYear}.`);
	await expect(page).toHaveURL(new RegExp(`year=${currentYear}$`));
	await expect(page.locator("#trends-period-note")).toContainText("Year to date");
	if (currentMonth < 12) await expect(page.locator(`#trends-chart button[data-month="${currentMonth + 1}"]`)).toBeDisabled();
	await page.route(`${api}/api/spotify/trends?*`, (route) => route.fulfill({ status: 503, json: {} }));
	await page.getByLabel("Year", { exact: true }).selectOption(String(previousYear));
	await expect(page.locator("#trends-status")).toContainText("unavailable");
	await expect(page.locator("#trends-artists")).toBeEmpty();
	await expect(page.locator("#trends-retry")).toBeVisible();
	await mockTrends(page);
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(page.locator("#trends-status")).toHaveText(`Showing ${previousYear}.`);
	await page.route(`${api}/api/spotify/trends?*`, (route) => route.fulfill({ status: 401, json: {} }));
	await page.getByRole("button", { name: new RegExp(`^March ${previousYear}:`) }).click();
	await expect(page.locator("#listening-dashboard")).toBeHidden();
	await expect(page.locator("#listening-access-status")).toContainText("expired");
});

test("late month responses cannot replace a newer selection or restore locked data", async ({ page }) => {
	await mockAccess(page);
	await mockTrends(page);
	await page.route(`${api}/api/auth/logout`, (route) => route.fulfill({ json: { data: { authenticated: false }, meta: {} } }));
	let release!: () => void;
	let started!: () => void;
	const waiting = new Promise<void>((resolve) => { release = resolve; });
	const requested = new Promise<void>((resolve) => { started = resolve; });
	await page.route(`${api}/api/spotify/trends?year=${previousYear}&month=3`, async (route) => {
		started();
		await waiting;
		await route.fulfill({ json: fixture(previousYear, 3) }).catch(() => undefined);
	});
	await page.goto(`/listening/trends/?year=${previousYear}`);
	await expect(page.locator("#trends-status")).toHaveText(`Showing ${previousYear}.`);
	await page.locator('#trends-chart button[data-month="3"]').click();
	await requested;
	await page.locator('#trends-chart button[data-month="4"]').click();
	await expect(page.locator("#trends-status")).toHaveText(`Showing April ${previousYear}.`);
	release();
	await expect(page.getByRole("heading", { name: `April ${previousYear}` })).toBeVisible();
	const lockedWaiting = new Promise<void>((resolve) => { release = resolve; });
	const lockedRequested = new Promise<void>((resolve) => { started = resolve; });
	await page.route(`${api}/api/spotify/trends?year=${previousYear}&month=3`, async (route) => {
		started();
		await lockedWaiting;
		await route.fulfill({ json: fixture(previousYear, 3) }).catch(() => undefined);
	});
	await page.locator('#trends-chart button[data-month="3"]').click();
	await lockedRequested;
	await page.getByRole("button", { name: "Lock", exact: true }).click();
	release();
	await expect(page.locator("#listening-dashboard")).toBeHidden();
	await expect(page.locator("#listening-dashboard")).not.toContainText(`Month artist ${previousYear}`);
});
