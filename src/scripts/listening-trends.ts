import { initializeListeningAccess } from "./listening-access";

interface Totals {
	plays: number;
	listeningTimeMs: number;
	uniqueArtists: number;
	uniqueTracks: number;
	recordedTimeMs: number;
	estimatedTimeMs: number;
}
interface Month {
	month: number;
	plays: number;
	listeningTimeMs: number;
	isToDate: boolean;
	isUpcoming: boolean;
	topArtist?: { name: string } | null;
	topGenre?: { name: string } | null;
	importCoverage?: string;
}
interface Genre { kind: "genre" | "other" | "unknown"; name: string; listeningTimeMs: number; sharePercent: number }
interface Artist {
	name: string;
	spotifyUrl: string | null;
	plays: number;
	listeningTimeMs: number;
}
interface Track {
	track: { name: string; spotifyUrl: string | null; artists: { name: string }[] };
	plays: number;
	listeningTimeMs: number;
}
interface Trends {
	year: number;
	month: number | null;
	importCoverage?: string;
	availableYears: number[];
	totals: Totals;
	months?: Month[];
	isToDate: boolean;
	isUpcoming: boolean;
	artists: Artist[];
	tracks: Track[];
	genres?: Genre[];
	topGenre?: { name: string } | null;
	genreCoverage?: { percentage: number; totalTimeMs: number; identifiedTimeMs: number };
}
interface Selection { year: number; month: number | null }

const number = new Intl.NumberFormat("en-GB");
const hours = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const months = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, index, 1))));

function readSelection(): Selection {
	const currentYear = Number(new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "Europe/London" }).format(new Date()));
	const params = new URLSearchParams(location.search);
	const year = params.get("year") ?? String(currentYear);
	const month = params.get("month");
	return {
		year: /^\d{4}$/.test(year) && Number(year) >= 2006 && Number(year) <= currentYear ? Number(year) : currentYear,
		month: month !== null && /^\d{1,2}$/.test(month) && Number(month) >= 1 && Number(month) <= 12 ? Number(month) : null,
	};
}

function duration(ms: number): string {
	if (ms > 0 && ms < 60000) return "<1 min";
	const minutes = Math.round(ms / 60000);
	if (minutes < 60) return `${number.format(minutes)} min`;
	return `${number.format(Math.floor(minutes / 60))} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

function coverageLabel(value?: string): string {
	return value === "incomplete" ? "Import incomplete" : value === "imported" ? "Imported history" : value === "live" ? "Live collection" : "Coverage not verified";
}

function spotifyHeading(name: string, value: string | null): HTMLElement {
	let url: URL | undefined;
	try {
		const candidate = new URL(value ?? "");
		if (candidate.protocol === "https:" && candidate.hostname === "open.spotify.com") url = candidate;
	} catch { /* Unresolved metadata is rendered as plain text. */ }
	const heading = document.createElement(url ? "a" : "strong");
	heading.textContent = name;
	if (heading instanceof HTMLAnchorElement && url) {
		heading.href = url.href;
		heading.target = "_blank";
		heading.rel = "noopener noreferrer";
	}
	return heading;
}

function startTrends(signal: AbortSignal, onUnauthorized: () => void): void {
	const root = document.querySelector<HTMLElement>("#listening-section");
	if (!root) return;
	const base = root.dataset.apiBase?.trim().replace(/\/$/, "") ?? "";
	const yearControl = root.querySelector<HTMLSelectElement>("#trends-year")!;
	const wholeYear = root.querySelector<HTMLButtonElement>("#trends-whole-year")!;
	const retry = root.querySelector<HTMLButtonElement>("#trends-retry")!;
	const chart = root.querySelector<HTMLElement>("#trends-chart")!;
	const highlights = root.querySelector<HTMLElement>("#trends-highlights")!;
	const detail = root.querySelector<HTMLElement>("#trends-detail")!;
	const status = root.querySelector<HTMLElement>("#trends-status")!;
	const empty = root.querySelector<HTMLElement>("#trends-empty")!;
	let selection = readSelection();
	let annual: Trends | undefined;
	let requestController: AbortController | undefined;
	let version = 0;
	signal.addEventListener("abort", () => requestController?.abort(), { once: true });

	function text(selector: string, value: string) {
		const element = root!.querySelector<HTMLElement>(selector);
		if (element) element.textContent = value;
	}
	function syncUrl(mode: "push" | "replace") {
		const url = new URL(location.href);
		url.searchParams.set("year", String(selection.year));
		if (selection.month === null) url.searchParams.delete("month");
		else url.searchParams.set("month", String(selection.month));
		if (url.href !== location.href) {
			if (mode === "push") history.pushState(null, "", url);
			else history.replaceState(null, "", url);
		}
	}
	function updateSelection() {
		text("#trends-period-heading", selection.month === null ? `Whole year · ${selection.year}` : `${months[selection.month - 1]} ${selection.year}`);
		wholeYear.setAttribute("aria-pressed", String(selection.month === null));
		root!.querySelectorAll<HTMLButtonElement>("button[data-month]").forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.month) === selection.month)));
	}
	function renderChart(data: Trends) {
		const maximum = Math.max(0, ...(data.months ?? []).map((entry) => entry.listeningTimeMs));
		const fragment = document.createDocumentFragment();
		for (const entry of data.months ?? []) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "trends-month";
			button.dataset.month = String(entry.month);
			button.dataset.empty = String(entry.plays === 0);
			button.disabled = entry.isUpcoming;
			button.setAttribute("aria-controls", "trends-detail");
			const note = entry.isUpcoming ? "Upcoming" : entry.importCoverage === "incomplete" ? "Import incomplete" : entry.isToDate ? "Month to date" : entry.plays === 0 ? "No recorded plays" : `${number.format(entry.plays)} plays`;
			button.setAttribute("aria-label", `${months[entry.month - 1]} ${data.year}: ${duration(entry.listeningTimeMs)}, ${note}`);
			const value = document.createElement("span");
			value.className = "trends-month__value";
			value.textContent = entry.isUpcoming ? "—" : `${hours.format(entry.listeningTimeMs / 3600000)} hr`;
			const plot = document.createElement("span");
			plot.className = "trends-month__plot";
			plot.setAttribute("aria-hidden", "true");
			const bar = document.createElement("span");
			bar.className = "trends-month__bar";
			bar.style.setProperty("--bar-height", `${maximum > 0 ? 100 * entry.listeningTimeMs / maximum : 0}%`);
			plot.append(bar);
			const label = document.createElement("span");
			label.className = "trends-month__label";
			label.textContent = months[entry.month - 1].slice(0, 3);
			const noteElement = document.createElement("span");
			noteElement.className = "trends-month__note";
			noteElement.textContent = note;
			button.append(value, plot, label, noteElement);
			fragment.append(button);
		}
		chart.replaceChildren(fragment);
		highlights.replaceChildren();
		for (const entry of data.months ?? []) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "trends-highlight";
			button.dataset.month = String(entry.month);
			button.disabled = entry.isUpcoming;
			button.setAttribute("aria-controls", "trends-detail");
			button.setAttribute("aria-label", `Explore ${months[entry.month - 1]} ${data.year} favourites`);
			const title = document.createElement("strong");
			title.textContent = months[entry.month - 1];
			const artist = document.createElement("span");
			artist.textContent = entry.isUpcoming ? "Upcoming" : entry.plays === 0 ? (entry.importCoverage === "incomplete" ? "Import incomplete" : "No recorded plays") : `Artist: ${entry.topArtist?.name ?? "Unresolved artist"}`;
			const genre = document.createElement("small");
			genre.textContent = entry.isUpcoming || entry.plays === 0 ? "" : entry.topGenre ? `Top identified genre: ${entry.topGenre.name}` : "No identified genre";
			button.append(title, artist, genre);
			highlights.append(button);
		}
		text("#trends-chart-heading", `Listening time by month · ${data.year}`);
		const years = [...new Set([...data.availableYears, data.year])].sort((a, b) => b - a);
		yearControl.replaceChildren(...years.map((year) => new Option(String(year), String(year))));
		yearControl.value = String(data.year);
		yearControl.disabled = false;
		wholeYear.disabled = false;
		updateSelection();
	}
	function renderRankings(selector: string, entries: { name: string; url: string | null; subtitle?: string; plays: number; listeningTimeMs: number }[]) {
		const list = root!.querySelector<HTMLOListElement>(selector)!;
		list.replaceChildren();
		if (entries.length === 0) {
			const row = document.createElement("li");
			row.className = "loading-row";
			row.textContent = "No recorded plays in this period.";
			list.append(row);
		}
		entries.forEach((entry, index) => {
			const row = document.createElement("li");
			const rank = document.createElement("span");
			rank.textContent = String(index + 1).padStart(2, "0");
			const heading = document.createElement("div");
			heading.append(spotifyHeading(entry.name, entry.url));
			const subtitle = document.createElement("small");
			subtitle.textContent = entry.subtitle ?? `${number.format(entry.plays)} plays`;
			heading.append(subtitle);
			const time = document.createElement("small");
			time.textContent = duration(entry.listeningTimeMs);
			row.append(rank, heading, time);
			list.append(row);
		});
	}
	function renderDetail(data: Trends) {
		for (const key of ["plays", "listeningTimeMs", "uniqueArtists", "uniqueTracks"] as const) {
			text(`[data-trend-total="${key}"]`, key === "listeningTimeMs" ? duration(data.totals[key]) : number.format(data.totals[key]));
		}
		text("#trends-period-note", data.isUpcoming ? "Upcoming" : [data.isToDate ? (data.month === null ? "Year to date" : "Month to date") : "", coverageLabel(data.importCoverage)].filter(Boolean).join(" · "));
		text("#trends-duration-note", `${duration(data.totals.recordedTimeMs)} recorded · ${duration(data.totals.estimatedTimeMs)} estimated from track lengths.`);
		empty.hidden = data.totals.plays > 0;
		empty.textContent = data.isUpcoming ? "This month is still ahead." : data.importCoverage === "incomplete" ? "History for this period is still being imported. No plays are recorded yet." : "No recorded plays for this period.";
		renderRankings("#trends-artists", data.artists.map((artist) => ({ ...artist, url: artist.spotifyUrl })));
		renderRankings("#trends-tracks", data.tracks.map((entry) => ({ name: entry.track.name, url: entry.track.spotifyUrl, subtitle: `${entry.track.artists.map((artist) => artist.name).join(", ")} · ${number.format(entry.plays)} plays`, plays: entry.plays, listeningTimeMs: entry.listeningTimeMs })));
		const list = root!.querySelector<HTMLOListElement>("#trends-genres")!;
		list.replaceChildren();
		text("#trends-genre-coverage", data.genreCoverage
			? data.genreCoverage.totalTimeMs > 0 ? `Genres identified for ${hours.format(data.genreCoverage.percentage)}% of listening time.` : "No listening time recorded for this period."
			: "Genre classifications are not available yet.");
		text("#trends-genre-leader", data.topGenre ? `Top identified genre: ${data.topGenre.name}` : "No identified genre for this period.");
		(data.genres ?? []).forEach((entry, index) => {
			const row = document.createElement("li");
			const rank = document.createElement("span");
			rank.textContent = entry.kind === "genre" ? String(index + 1).padStart(2, "0") : "—";
			const heading = document.createElement("div");
			const name = document.createElement("strong");
			name.textContent = entry.name;
			const share = document.createElement("small");
			share.textContent = `${hours.format(entry.sharePercent)}% of listening time`;
			heading.append(name, share);
			const time = document.createElement("small");
			time.textContent = duration(entry.listeningTimeMs);
			row.append(rank, heading, time);
			list.append(row);
		});
	}
	async function request(year: number, month: number | null, requestSignal: AbortSignal): Promise<{ data: Trends; meta: { generatedAt: string } }> {
		const params = new URLSearchParams({ year: String(year) });
		if (month !== null) params.set("month", String(month));
		const response = await fetch(`${base}/api/spotify/trends?${params}`, { credentials: "include", cache: "no-store", signal: requestSignal, headers: { Accept: "application/json" } });
		requestSignal.throwIfAborted();
		if (response.status === 401) { onUnauthorized(); throw new Error("Session expired"); }
		if (!response.ok) throw new Error("Listening trends are unavailable. Please try again.");
		const payload = await response.json();
		requestSignal.throwIfAborted();
		if (!payload.data || !payload.meta || payload.data.year !== year || payload.data.month !== month || !payload.data.totals || !Array.isArray(payload.data.artists) || !Array.isArray(payload.data.tracks) || (month === null && !Array.isArray(payload.data.months))) throw new Error("Listening trends returned an unexpected response.");
		return payload;
	}
	async function load(next: Selection, mode: "push" | "replace" = "replace") {
		requestController?.abort();
		requestController = new AbortController();
		const requestSignal = requestController.signal;
		const thisVersion = ++version;
		selection = next;
		syncUrl(mode);
		updateSelection();
		text("#trends-chart-heading", `Listening time by month · ${next.year}`);
		status.dataset.state = "loading";
		status.textContent = "Loading listening trends…";
		retry.hidden = true;
		detail.setAttribute("aria-busy", "true");
		root!.querySelectorAll<HTMLElement>("[data-trend-total]").forEach((element) => element.textContent = "—");
		for (const selector of ["#trends-artists", "#trends-tracks", "#trends-genres", "#trends-genre-coverage", "#trends-genre-leader", "#trends-duration-note", "#trends-period-note"]) text(selector, "");
		empty.hidden = true;
		if (annual?.year !== next.year) { annual = undefined; chart.replaceChildren(); highlights.replaceChildren(); }
		try {
			if (!annual) {
				const response = await request(next.year, null, requestSignal);
				if (signal.aborted || thisVersion !== version) return;
				annual = response.data;
				renderChart(annual);
			}
			const data = next.month === null ? annual : (await request(next.year, next.month, requestSignal)).data;
			if (signal.aborted || requestSignal.aborted || thisVersion !== version) return;
			renderDetail(data);
			status.dataset.state = "ready";
			status.textContent = `Showing ${next.month === null ? next.year : `${months[next.month - 1]} ${next.year}`}.`;
		} catch (error) {
			if (signal.aborted || requestSignal.aborted || thisVersion !== version) return;
			status.dataset.state = "error";
			status.textContent = error instanceof TypeError ? "Could not connect. Check your connection and try again." : (error as Error).message;
			retry.hidden = false;
		} finally {
			if (!signal.aborted && thisVersion === version) detail.setAttribute("aria-busy", "false");
		}
	}

	yearControl.addEventListener("change", () => void load({ year: Number(yearControl.value), month: null }, "push"), { signal });
	wholeYear.addEventListener("click", () => void load({ year: selection.year, month: null }, "push"), { signal });
	retry.addEventListener("click", () => void load(selection), { signal });
	root.addEventListener("click", (event) => {
		const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-month]");
		if (button && !button.disabled) void load({ year: selection.year, month: Number(button.dataset.month) }, "push");
	}, { signal });
	window.addEventListener("popstate", () => void load(readSelection()), { signal });
	void load(selection);
}

initializeListeningAccess(startTrends);
