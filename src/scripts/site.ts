const header = document.getElementById("headerTop");
const navMenu = document.querySelector<HTMLElement>(".navMenu");
const navButton = document.querySelector<HTMLButtonElement>(".navButton");
const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("#menuList a"));
const observedSections = navLinks
	.map((link) => document.querySelector<HTMLElement>(link.hash))
	.filter((section): section is HTMLElement => Boolean(section));

function setHeaderState() {
	if (!header) {
		return;
	}

	header.classList.toggle("headerScrolled", window.scrollY > 48);
}

function setCurrentNavItem(sectionId: string) {
	for (const link of navLinks) {
		const item = link.querySelector(".navItem");
		item?.classList.toggle("current", link.hash === `#${sectionId}`);
	}
}

function setCurrentSectionFromScroll() {
	const marker = window.scrollY + window.innerHeight * 0.62;
	let currentSection = observedSections[0];

	for (const section of observedSections) {
		if (section.offsetTop <= marker) {
			currentSection = section;
		}
	}

	if (currentSection) {
		setCurrentNavItem(currentSection.id);
	}
}

function closeMenu() {
	navMenu?.classList.remove("openMenu");
	navButton?.setAttribute("aria-expanded", "false");
}

navButton?.addEventListener("click", () => {
	const isOpen = navMenu?.classList.toggle("openMenu") ?? false;
	navButton.setAttribute("aria-expanded", String(isOpen));
});

for (const link of navLinks) {
	link.addEventListener("click", closeMenu);
}

window.addEventListener(
	"scroll",
	() => {
		setHeaderState();
		setCurrentSectionFromScroll();
	},
	{ passive: true }
);
window.addEventListener("resize", () => {
	if (window.innerWidth > 720) {
		closeMenu();
	}

	setCurrentSectionFromScroll();
});

setHeaderState();
setCurrentSectionFromScroll();

type Period = "7d" | "30d" | "year" | "all";

interface PublicArtist {
	id: string;
	name: string;
}

interface PublicTrack {
	id: string;
	name: string;
	artists: PublicArtist[];
	album: {
		id: string;
		name: string;
		artworkUrl: string | null;
	};
	durationMs: number;
	spotifyUrl: string | null;
}

interface SummaryTotals {
	plays: number;
	listeningTimeMs: number;
	uniqueArtists: number;
	uniqueTracks: number;
}

interface ApiEnvelope<T> {
	data: T;
	meta: {
		generatedAt: string;
		period?: string;
	};
}

interface ApiErrorEnvelope {
	error?: {
		code?: string;
		message?: string;
	};
}

interface NowPlayingData {
	isPlaying: boolean;
	progressMs: number | null;
	checkedAt: string;
	playedAt?: string;
	track: PublicTrack;
}

interface RankingArtist extends PublicArtist {
	spotifyUrl: string | null;
	plays: number;
	listeningTimeMs: number;
}

interface RankedTrack {
	track: PublicTrack;
	plays: number;
	listeningTimeMs: number;
}

interface ActivityDay {
	date: string;
	plays: number;
	listeningTimeMs: number;
}

interface ArchiveTrack {
	track: PublicTrack;
	firstPlayed: string;
	lastPlayed: string;
	totalPlays: number;
	playsThisYear: number;
	playsThisMonth: number;
	totalListeningTimeMs: number;
}

interface RecentPlay {
	track: PublicTrack;
	playedAt: string;
}

const listeningSection = document.getElementById("listening-section");
const listeningStatus = document.getElementById("listening-status");
const apiBase = listeningSection?.dataset.apiBase?.trim().replace(/\/$/, "") ?? "";
const numberFormatter = new Intl.NumberFormat("en-GB");
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
	dateStyle: "medium",
	timeStyle: "short",
	timeZone: "Europe/London",
});
let progressTimer: number | undefined;
let nowPlayingPollTimer: number | undefined;

function setListeningStatus(message: string, state: "ready" | "error" | "loading" = "ready") {
	if (!listeningStatus) {
		return;
	}

	listeningStatus.textContent = message;
	listeningStatus.dataset.state = state;
}

function setText(selector: string, value: string) {
	const element = listeningSection?.querySelector<HTMLElement>(selector);
	if (element) {
		element.textContent = value;
	}
}

function formatDuration(durationMs: number): string {
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		return "0 min";
	}

	const totalMinutes = Math.round(durationMs / 60000);
	if (totalMinutes < 60) {
		return `${numberFormatter.format(totalMinutes)} min`;
	}

	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes === 0
		? `${numberFormatter.format(hours)} hr`
		: `${numberFormatter.format(hours)} hr ${minutes} min`;
}

function formatPlaybackTime(durationMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "Unknown" : dateFormatter.format(date);
}

function artistNames(track: PublicTrack): string {
	return track.artists.map((artist) => artist.name).join(", ") || "Unknown artist";
}

function safeExternalUrl(value: string | null): string | null {
	if (!value) {
		return null;
	}

	try {
		const url = new URL(value);
		return url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}

function createTrackHeading(track: PublicTrack): HTMLElement {
	const wrapper = document.createElement("div");
	const spotifyUrl = safeExternalUrl(track.spotifyUrl);
	const title = spotifyUrl ? document.createElement("a") : document.createElement("strong");
	title.textContent = track.name;

	if (title instanceof HTMLAnchorElement && spotifyUrl) {
		title.href = spotifyUrl;
		title.target = "_blank";
		title.rel = "noreferrer";
	}

	const details = document.createElement("small");
	details.textContent = artistNames(track);
	wrapper.append(title, details);
	return wrapper;
}

async function requestApi<T>(path: string): Promise<ApiEnvelope<T>> {
	const response = await fetch(`${apiBase}${path}`, {
		headers: { Accept: "application/json" },
	});
	const payload = await response.json() as ApiEnvelope<T> & ApiErrorEnvelope;

	if (!response.ok) {
		throw new Error(payload.error?.message || `Request failed with status ${response.status}`);
	}

	if (!("data" in payload) || !("meta" in payload)) {
		throw new Error("The listening API returned an unexpected response");
	}

	return payload;
}

function renderNowPlaying(data: NowPlayingData | null) {
	if (progressTimer !== undefined) {
		window.clearInterval(progressTimer);
		progressTimer = undefined;
	}

	const artwork = document.getElementById("now-playing-artwork");
	if (artwork) {
		artwork.replaceChildren();
	}

	if (!data) {
		setText("#now-playing-label", "Listening status");
		setText("#now-playing-track", "No plays recorded yet");
		setText("#now-playing-artist", "The archive will populate after the first ingestion run.");
		setText("#now-playing-album", "");
		document.getElementById("now-playing-progress")?.setAttribute("hidden", "");
		return;
	}

	setText("#now-playing-label", data.isPlaying ? "Now playing" : "Recently played");
	setText("#now-playing-track", data.track.name);
	setText("#now-playing-artist", artistNames(data.track));
	setText(
		"#now-playing-album",
		data.isPlaying || !data.playedAt
			? data.track.album.name
			: `${data.track.album.name} - ${formatDate(data.playedAt)}`,
	);

	const artworkUrl = safeExternalUrl(data.track.album.artworkUrl);
	if (artwork && artworkUrl) {
		const image = document.createElement("img");
		image.src = artworkUrl;
		image.alt = "";
		image.width = 280;
		image.height = 280;
		artwork.append(image);
	}

	const progress = document.getElementById("now-playing-progress");
	const progressFill = progress?.querySelector<HTMLElement>(".play-progress__track span");
	if (!data.isPlaying || data.progressMs === null || data.track.durationMs <= 0) {
		progress?.setAttribute("hidden", "");
		return;
	}

	progress?.removeAttribute("hidden");
	const checkedAt = Date.parse(data.checkedAt);
	const startingProgress = data.progressMs;
	const updateProgress = () => {
		const elapsedSinceCheck = Number.isFinite(checkedAt) ? Math.max(0, Date.now() - checkedAt) : 0;
		const elapsed = Math.min(data.track.durationMs, startingProgress + elapsedSinceCheck);
		if (progressFill) {
			progressFill.style.width = `${Math.min(100, (elapsed / data.track.durationMs) * 100)}%`;
		}
		setText("#now-playing-elapsed", formatPlaybackTime(elapsed));
		setText("#now-playing-duration", formatPlaybackTime(data.track.durationMs));
	};

	updateProgress();
	progressTimer = window.setInterval(updateProgress, 1000);
}

async function loadNowPlaying() {
	const { data } = await requestApi<NowPlayingData | null>("/api/spotify/now-playing");
	renderNowPlaying(data);
}

async function loadSummary() {
	const [today, month] = await Promise.all([
		requestApi<{ period: "today"; totals: SummaryTotals }>("/api/spotify/summary?period=today"),
		requestApi<{ period: "month"; totals: SummaryTotals }>("/api/spotify/summary?period=month"),
	]);

	setText('[data-summary="playsToday"]', numberFormatter.format(today.data.totals.plays));
	setText('[data-summary="playsThisMonth"]', numberFormatter.format(month.data.totals.plays));
	setText('[data-summary="listeningTimeMs"]', formatDuration(month.data.totals.listeningTimeMs));
	setText('[data-summary="uniqueArtists"]', numberFormatter.format(month.data.totals.uniqueArtists));
	setText('[data-summary="uniqueTracks"]', numberFormatter.format(month.data.totals.uniqueTracks));
}

function renderArtistRanking(artists: RankingArtist[]) {
	const list = document.getElementById("top-artists-list");
	if (!list) return;
	list.replaceChildren();

	if (artists.length === 0) {
		const empty = document.createElement("li");
		empty.className = "loading-row";
		empty.textContent = "No artist plays in this period.";
		list.append(empty);
		return;
	}

	artists.forEach((artist, index) => {
		const item = document.createElement("li");
		const rank = document.createElement("span");
		rank.textContent = String(index + 1).padStart(2, "0");
		const details = document.createElement("div");
		const url = safeExternalUrl(artist.spotifyUrl);
		const name = url ? document.createElement("a") : document.createElement("strong");
		name.textContent = artist.name;
		if (name instanceof HTMLAnchorElement && url) {
			name.href = url;
			name.target = "_blank";
			name.rel = "noreferrer";
		}
		const duration = document.createElement("small");
		duration.textContent = formatDuration(artist.listeningTimeMs);
		details.append(name, duration);
		const plays = document.createElement("small");
		plays.textContent = `${numberFormatter.format(artist.plays)} plays`;
		item.append(rank, details, plays);
		list.append(item);
	});
}

function renderTrackRanking(tracks: RankedTrack[]) {
	const list = document.getElementById("top-tracks-list");
	if (!list) return;
	list.replaceChildren();

	if (tracks.length === 0) {
		const empty = document.createElement("li");
		empty.className = "loading-row";
		empty.textContent = "No track plays in this period.";
		list.append(empty);
		return;
	}

	tracks.forEach((entry, index) => {
		const item = document.createElement("li");
		const rank = document.createElement("span");
		rank.textContent = String(index + 1).padStart(2, "0");
		const plays = document.createElement("small");
		plays.textContent = `${numberFormatter.format(entry.plays)} plays`;
		item.append(rank, createTrackHeading(entry.track), plays);
		list.append(item);
	});
}

async function loadRanking(kind: "artists" | "tracks", period: Period) {
	if (kind === "artists") {
		const { data } = await requestApi<{ period: Period; artists: RankingArtist[] }>(
			`/api/spotify/top-artists?period=${period}`,
		);
		renderArtistRanking(data.artists);
		return;
	}

	const { data } = await requestApi<{ period: Period; tracks: RankedTrack[] }>(
		`/api/spotify/top-tracks?period=${period}`,
	);
	renderTrackRanking(data.tracks);
}

function currentLondonDate(): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		timeZone: "Europe/London",
	}).formatToParts(new Date());
	const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	return `${values.year}-${values.month}-${values.day}`;
}

function renderHeatmap(days: ActivityDay[]) {
	const heatmap = document.getElementById("listening-heatmap");
	if (!heatmap) return;
	heatmap.replaceChildren();

	const playsByDate = new Map(days.map((day) => [day.date, day.plays]));
	const maximum = Math.max(0, ...days.map((day) => day.plays));
	const today = currentLondonDate();
	const end = new Date(`${today}T00:00:00Z`);
	let cursor = new Date(end);
	cursor.setUTCDate(cursor.getUTCDate() - 364);
	const leadingEmptyDays = (cursor.getUTCDay() + 6) % 7;
	for (let index = 0; index < leadingEmptyDays; index += 1) {
		const empty = document.createElement("span");
		empty.className = "heatmap-day heatmap-day--empty";
		empty.setAttribute("aria-hidden", "true");
		heatmap.append(empty);
	}

	while (cursor <= end) {
		const date = cursor.toISOString().slice(0, 10);
		const plays = playsByDate.get(date) ?? 0;
		const level = plays === 0 || maximum === 0 ? 0 : Math.min(4, Math.ceil((plays / maximum) * 4));
		const day = document.createElement("span");
		day.className = "heatmap-day";
		day.dataset.level = String(level);
		day.title = `${date}: ${numberFormatter.format(plays)} plays`;
		day.setAttribute("aria-label", day.title);
		heatmap.append(day);
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
}

async function loadActivity() {
	const { data } = await requestApi<{ period: "year"; days: ActivityDay[] }>(
		"/api/spotify/activity?period=year",
	);
	renderHeatmap(data.days);
}

function renderRecentPlays(plays: RecentPlay[]) {
	const list = document.getElementById("recent-plays-list");
	if (!list) return;
	list.replaceChildren();

	if (plays.length === 0) {
		const empty = document.createElement("li");
		empty.className = "loading-row";
		empty.textContent = "No recent plays recorded.";
		list.append(empty);
		return;
	}

	plays.forEach((play) => {
		const item = document.createElement("li");
		const time = document.createElement("time");
		time.dateTime = play.playedAt;
		time.textContent = formatDate(play.playedAt);
		item.append(createTrackHeading(play.track), time);
		list.append(item);
	});
}

async function loadRecentPlays() {
	const { data } = await requestApi<{ plays: RecentPlay[] }>("/api/spotify/recent");
	renderRecentPlays(data.plays);
}

async function loadLifetime() {
	const { data } = await requestApi<{ totals: SummaryTotals & { firstPlayed: string | null; lastPlayed: string | null } }>(
		"/api/spotify/lifetime",
	);
	setText('[data-lifetime="plays"]', numberFormatter.format(data.totals.plays));
	setText('[data-lifetime="listeningTimeMs"]', formatDuration(data.totals.listeningTimeMs));
	setText('[data-lifetime="uniqueArtists"]', numberFormatter.format(data.totals.uniqueArtists));
	setText('[data-lifetime="uniqueTracks"]', numberFormatter.format(data.totals.uniqueTracks));
}

function renderArchiveResults(results: ArchiveTrack[]) {
	const container = document.getElementById("archive-results");
	if (!container) return;
	container.replaceChildren();

	if (results.length === 0) {
		const empty = document.createElement("p");
		empty.className = "inline-message";
		empty.textContent = "No matching tracks found.";
		container.append(empty);
		return;
	}

	results.forEach((result) => {
		const article = document.createElement("article");
		article.className = "archive-result";
		article.append(createTrackHeading(result.track));
		const stats = document.createElement("div");
		stats.className = "archive-result__stats";
		const values: Array<[string, string]> = [
			["First played", formatDate(result.firstPlayed)],
			["Last played", formatDate(result.lastPlayed)],
			["Total plays", numberFormatter.format(result.totalPlays)],
			["This year", numberFormatter.format(result.playsThisYear)],
			["This month", numberFormatter.format(result.playsThisMonth)],
			["Estimated listening", formatDuration(result.totalListeningTimeMs)],
		];
		values.forEach(([label, value]) => {
			const item = document.createElement("span");
			const strong = document.createElement("strong");
			item.textContent = label;
			strong.textContent = value;
			item.append(strong);
			stats.append(item);
		});
		article.append(stats);
		container.append(article);
	});
}

async function searchArchive(query: string) {
	const { data } = await requestApi<{ query: string; tracks: ArchiveTrack[] }>(
		`/api/spotify/archive/search?q=${encodeURIComponent(query)}`,
	);
	renderArchiveResults(data.tracks);
}

function setListMessage(id: string, message: string) {
	const list = document.getElementById(id);
	if (!list) return;
	const item = document.createElement("li");
	item.className = "loading-row";
	item.textContent = message;
	list.replaceChildren(item);
}

function disableListeningControls() {
	listeningSection?.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input").forEach((control) => {
		control.disabled = true;
	});
	setListMessage("top-artists-list", "Backend not configured.");
	setListMessage("top-tracks-list", "Backend not configured.");
	setListMessage("recent-plays-list", "Backend not configured.");
	renderNowPlaying(null);
}

function registerListeningInteractions() {
	listeningSection?.querySelectorAll<HTMLElement>(".period-control").forEach((control) => {
		control.addEventListener("click", async (event) => {
			const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-period]");
			const kind = control.dataset.ranking as "artists" | "tracks" | undefined;
			const period = button?.dataset.period as Period | undefined;
			if (!button || !kind || !period || button.getAttribute("aria-pressed") === "true") return;

			control.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
			button.disabled = true;
			try {
				await loadRanking(kind, period);
			} catch (error) {
				setListMessage(
					kind === "artists" ? "top-artists-list" : "top-tracks-list",
					error instanceof Error ? error.message : "Unable to load this ranking.",
				);
			} finally {
				button.disabled = false;
			}
		});
	});

	document.getElementById("archive-search-form")?.addEventListener("submit", async (event) => {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const query = new FormData(form).get("q")?.toString().trim() ?? "";
		const results = document.getElementById("archive-results");
		if (query.length < 2) return;
		if (results) results.textContent = "Searching...";
		try {
			await searchArchive(query);
		} catch (error) {
			if (results) results.textContent = error instanceof Error ? error.message : "Search is unavailable.";
		}
	});
}

async function initializeListeningStats() {
	if (!listeningSection) {
		return;
	}

	if (!apiBase) {
		setListeningStatus("Listening stats backend is not configured yet.", "error");
		disableListeningControls();
		return;
	}

	registerListeningInteractions();
	setListeningStatus("Loading listening stats...", "loading");
	const tasks = [
		loadNowPlaying(),
		loadSummary(),
		loadRanking("artists", "7d"),
		loadRanking("tracks", "7d"),
		loadActivity(),
		loadRecentPlays(),
		loadLifetime(),
	];
	const results = await Promise.allSettled(tasks);
	const failures = results.filter((result) => result.status === "rejected");
	if (results[0].status === "rejected") {
		setText("#now-playing-label", "Listening status");
		setText("#now-playing-track", "Playback unavailable");
		setText("#now-playing-artist", "The current track could not be loaded.");
		setText("#now-playing-album", "");
	}
	if (results[1].status === "rejected") {
		listeningSection.querySelectorAll<HTMLElement>("[data-summary]").forEach((element) => {
			element.textContent = "Unavailable";
		});
	}
	if (results[2].status === "rejected") setListMessage("top-artists-list", "Top artists are unavailable.");
	if (results[3].status === "rejected") setListMessage("top-tracks-list", "Top tracks are unavailable.");
	if (results[4].status === "rejected") {
		const heatmap = document.getElementById("listening-heatmap");
		if (heatmap) heatmap.textContent = "Listening activity is unavailable.";
	}
	if (results[5].status === "rejected") setListMessage("recent-plays-list", "Recent plays are unavailable.");
	if (results[6].status === "rejected") {
		listeningSection.querySelectorAll<HTMLElement>("[data-lifetime]").forEach((element) => {
			element.textContent = "Unavailable";
		});
	}

	if (failures.length === 0) {
		setListeningStatus(`Updated ${dateFormatter.format(new Date())}`);
	} else {
		setListeningStatus(`${failures.length} listening view${failures.length === 1 ? "" : "s"} could not be loaded.`, "error");
	}

	nowPlayingPollTimer = window.setInterval(() => {
		if (document.visibilityState === "visible") {
			void loadNowPlaying().catch(() => undefined);
		}
	}, 30000);
}

void initializeListeningStats();

window.addEventListener("beforeunload", () => {
	if (progressTimer !== undefined) window.clearInterval(progressTimer);
	if (nowPlayingPollTimer !== undefined) window.clearInterval(nowPlayingPollTimer);
});
