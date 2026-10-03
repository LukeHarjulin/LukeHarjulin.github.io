import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const api = "http://127.0.0.1:8788";
test("the persistent cookie survives closing and reopening the browser", async () => {
	// Keep the browser's locked database files outside Astro's watched project.
	const directory = await mkdtemp(join(tmpdir(), "listening-browser-"));
	const options = { headless: true, channel: process.platform === "win32" ? "msedge" : undefined };
	let browser = await chromium.launchPersistentContext(directory, options);
	try {
		let page = await browser.newPage();
		await page.goto("http://127.0.0.1:8000/listening/");
		await expect(page.getByRole("button", { name: "Unlock", exact: true })).toBeEnabled();
		await page.getByLabel("Shared passphrase").fill("test listening phrase");
		await page.getByRole("button", { name: "Unlock", exact: true }).click();
		await expect(page.locator("#listening-dashboard")).toBeVisible();
		await browser.close();
		browser = await chromium.launchPersistentContext(directory, options);
		page = await browser.newPage();
		await page.goto("http://127.0.0.1:8000/listening/");
		await expect(page.locator("#listening-dashboard")).toBeVisible();
	} finally {
		await browser.close();
		if (resolve(dirname(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("listening-browser-")) throw new Error("Unexpected browser profile path");
		await rm(directory, { recursive: true, force: true, maxRetries: 3 });
	}
});

test("the page locks at its fixed expiry without waiting for a data request", async ({ page }) => {
	await page.clock.install();
	await page.route(`${api}/api/auth/session`, (route) => route.fulfill({ json: { data: { authenticated: true, expiresAt: Date.now() + 1000 }, meta: {} } }));
	await page.route(`${api}/api/spotify/**`, (route) => route.fulfill({ status: 503, json: { error: { message: "Synthetic unavailable response" } } }));
	await page.goto("/listening/");
	await expect(page.locator("#listening-dashboard")).toBeVisible();
	await page.clock.runFor(1500);
	await expect(page.locator("#listening-dashboard")).toBeHidden();
	await expect(page.locator("#listening-access-status")).toContainText("expired");
});
test("unlock, persistence, cache protection, lock, and mobile layout", async ({ page, context }, testInfo) => {
	const errors: string[] = [];
	const dataRequests: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("request", (request) => { if (request.url().includes("/api/spotify/")) dataRequests.push(request.url()); });
	await page.goto("/listening/");
	await expect(page.getByRole("button", { name: "Unlock", exact: true })).toBeEnabled();
	await expect(page.locator("#listening-dashboard")).toBeHidden();
	expect(dataRequests).toHaveLength(0);
	await page.screenshot({ path: testInfo.outputPath("listening-desktop.png"), fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ path: testInfo.outputPath("listening-mobile.png"), fullPage: true });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	const input = page.getByLabel("Shared passphrase");
	await input.fill("incorrect phrase");
	await page.getByRole("button", { name: "Show", exact: true }).click();
	await expect(input).toHaveAttribute("type", "text");
	await input.press("Enter");
	await expect(page.getByRole("status").filter({ hasText: "Incorrect passphrase" })).toBeVisible();
	await input.fill("test listening phrase");
	await input.press("Enter");
	await expect(page.locator("#listening-dashboard")).toBeVisible();
	await expect(input).toHaveValue("");
	const cookie = (await context.cookies(api)).find((item) => item.name === "listening_session_local")!;
	expect(cookie.httpOnly).toBe(true);
	expect(cookie.sameSite).toBe("Strict");
	expect(cookie.expires - Date.now() / 1000).toBeGreaterThan(604700);
	await page.reload();
	await expect(page.locator("#listening-dashboard")).toBeVisible();
	await page.getByRole("button", { name: "Lock", exact: true }).click();
	await expect(page.locator("#listening-access-status")).toHaveText("Listening is locked.");
	await expect(page.locator("#listening-dashboard")).toBeHidden();
	expect((await context.cookies(api)).some((item) => item.name === cookie.name)).toBe(false);
	expect((await context.request.get(`${api}/api/spotify/lifetime`)).status()).toBe(401);
	await page.reload();
	await expect(page.locator("#listening-dashboard")).toBeHidden();
	await expect(page.getByRole("button", { name: "Unlock", exact: true })).toBeEnabled();
	expect(errors).toEqual([]);
});

test("expired sessions and late responses cannot restore private data or duplicate timers", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	let authenticated = true;
	let nowPlayingRequests = 0;
	let expiresAt = Date.now() + 604800000;
	await page.route(`${api}/api/auth/**`, async (route) => {
		if (route.request().url().endsWith("/login")) authenticated = true;
		if (route.request().url().endsWith("/logout")) authenticated = false;
		await route.fulfill({ json: { data: { authenticated, expiresAt }, meta: {} }, headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:8000", "Access-Control-Allow-Credentials": "true" } });
	});
	await page.route(`${api}/api/spotify/**`, async (route) => {
		if (route.request().url().includes("now-playing")) nowPlayingRequests++;
		await route.fulfill({ status: 503, json: { error: { message: "Synthetic unavailable response" } } });
	});
	await page.clock.install();
	await page.goto("/listening/");
	await expect(page.locator("#listening-dashboard")).toBeVisible();
	await expect(page.locator("#listening-status")).toContainText("could not be loaded");
	await page.getByRole("button", { name: "Lock", exact: true }).click();
	await expect(page.locator("#listening-access-status")).toHaveText("Listening is locked.");
	const lockedCount = nowPlayingRequests;
	await page.clock.runFor(61000);
	expect(nowPlayingRequests).toBe(lockedCount);
	await page.getByLabel("Shared passphrase").fill("test listening phrase");
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expect(page.locator("#listening-dashboard")).toBeVisible();
	await expect(page.locator("#listening-status")).toContainText("could not be loaded");
	const count = nowPlayingRequests;
	await page.clock.runFor(30000);
	await expect.poll(() => nowPlayingRequests).toBe(count + 1);
	// Simulate an expired cookie being rejected by the API while polling.
	await page.route(`${api}/api/spotify/now-playing`, (route) => route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED" } } }));
	await page.clock.runFor(30000);
	await expect(page.locator("#listening-dashboard")).toBeHidden();
	await expect(page.locator("#listening-access-status")).toContainText("expired");
	await page.clock.runFor(60000);
	await expect(page.locator("#listening-dashboard")).toBeHidden();
	expect(errors).toEqual([]);
});

test("network/rate-limit messages, pending requests, and restored-page revalidation", async ({ page }) => {
	await page.route(`${api}/api/auth/session`, (route) => route.fulfill({ json: { data: { authenticated: false }, meta: {} } }));
	await page.route(`${api}/api/auth/login`, (route) => route.fulfill({ status: 429, json: {} }));
	await page.goto("/listening/");
	await page.getByLabel("Shared passphrase").fill("test listening phrase");
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expect(page.locator("#listening-access-status")).toContainText("Too many attempts");
	await page.route(`${api}/api/auth/login`, (route) => route.abort());
	await page.getByLabel("Shared passphrase").fill("test listening phrase");
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expect(page.locator("#listening-access-status")).toContainText("Could not connect");
	await page.route(`${api}/api/auth/session`, (route) => route.fulfill({ json: { data: { authenticated: true, expiresAt: Date.now() + 604800000 }, meta: {} } }));
	let release!: () => void;
	const waiting = new Promise<void>((resolve) => { release = resolve; });
	await page.route(`${api}/api/spotify/**`, async (route) => {
		await waiting;
		await route.fulfill({ json: { data: { totals: { plays: 123456789 } }, meta: {} } }).catch(() => undefined);
	});
	await page.reload();
	await expect(page.locator("#listening-dashboard")).toBeVisible();
	await page.route(`${api}/api/auth/logout`, (route) => route.fulfill({ json: { data: { authenticated: false }, meta: {} } }));
	await page.getByRole("button", { name: "Lock", exact: true }).click();
	await expect(page.locator("#listening-dashboard")).toBeHidden();
	release();
	await expect(page.locator("#listening-dashboard")).not.toContainText("123,456,789");
	await page.route(`${api}/api/auth/session`, (route) => route.fulfill({ json: { data: { authenticated: false }, meta: {} } }));
	await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
	await expect(page.locator("#listening-access-status")).toContainText("Enter the shared passphrase");
	await expect(page.locator("#listening-dashboard")).toBeHidden();
	await page.goto("/");
	await expect(page.locator("#home-section")).toBeVisible();
});
