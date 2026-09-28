import type { AlbumRecommendations } from "../data/album-recommendation";

export function restoreRecommendationIndex(raw: string | null, data: AlbumRecommendations): number {
	try {
		const saved = JSON.parse(raw ?? "null");
		if (saved?.date !== data.date || saved?.generatedAt !== data.generatedAt) return 0;
		const index = data.items.findIndex((item) => item.id === saved.id);
		return Math.max(0, index);
	} catch { return 0; }
}

export async function initializeAlbumRecommendations(load: () => Promise<AlbumRecommendations>): Promise<void> {
	const panel = document.getElementById("album-recommendations");
	if (!panel) return;
	const status = panel.querySelector<HTMLElement>("[data-recommendation-status]")!;
	const content = panel.querySelector<HTMLElement>("[data-recommendation-content]")!;
	const skip = panel.querySelector<HTMLButtonElement>("[data-recommendation-skip]")!;
	const reset = panel.querySelector<HTMLButtonElement>("[data-recommendation-reset]")!;
	const storageKey = "listening-album-pick-v1";
	let data: AlbumRecommendations;
	let index = 0;
	let loadedDay = "";
	let loading = false;
	const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
	const save = () => {
		try { localStorage.setItem(storageKey, JSON.stringify({ date: data.date, generatedAt: data.generatedAt, id: data.items[index]?.id })); }
		catch { /* Browsing and skipping still work when storage is disabled. */ }
	};
	const render = () => {
		const item = data.items[index];
		content.hidden = !item;
		skip.disabled = !item || index >= data.items.length - 1;
		reset.hidden = index === 0;
		if (!item) {
			status.textContent = "The next album suggestion is being prepared. Check back later.";
			return;
		}
		panel.querySelector<HTMLElement>("[data-recommendation-name]")!.textContent = item.name;
		panel.querySelector<HTMLElement>("[data-recommendation-artist]")!.textContent = item.artist;
		panel.querySelector<HTMLElement>("[data-recommendation-reason]")!.textContent = item.reason;
		panel.querySelector<HTMLElement>("[data-recommendation-kind]")!.textContent = {
			rediscovery: "Worth another listen", exploration: "More from a favourite", discovery: "Something new",
		}[item.kind];
		const link = panel.querySelector<HTMLAnchorElement>("[data-recommendation-link]")!;
		link.href = /^https:\/\/open\.spotify\.com\/album\/[a-zA-Z0-9]{22}$/.test(item.spotifyUrl) ? item.spotifyUrl : "https://open.spotify.com/";
		const artwork = panel.querySelector<HTMLImageElement>("[data-recommendation-artwork]")!;
		artwork.hidden = !item.artworkUrl;
		if (item.artworkUrl && /^https:\/\/i\.scdn\.co\//.test(item.artworkUrl)) {
			artwork.src = item.artworkUrl;
			artwork.alt = `${item.name} album cover`;
		} else { artwork.removeAttribute("src"); artwork.hidden = true; }
		artwork.onerror = () => { artwork.hidden = true; };
		const exhausted = index === data.items.length - 1 ? " No more alternatives today." : "";
		status.textContent = `${data.stale ? `Latest available pick (${data.date})` : index === 0 ? "Today's album" : "Your alternative for today"}: ${item.name} by ${item.artist}.${exhausted}`;
	};
	const refresh = async () => {
		if (loading) return;
		loading = true;
		skip.disabled = true;
		try {
			data = await load();
			loadedDay = today();
			let raw: string | null = null;
			try { raw = localStorage.getItem(storageKey); } catch { /* Optional storage. */ }
			index = restoreRecommendationIndex(raw, data);
			render();
		} catch {
			content.hidden = true;
			reset.hidden = true;
			status.textContent = "Album suggestions are temporarily unavailable.";
		} finally { loading = false; }
	};
	skip.addEventListener("click", async () => {
		if (today() !== loadedDay) { await refresh(); return; }
		if (index < data.items.length - 1) { index++; save(); render(); }
	});
	reset.addEventListener("click", () => { index = 0; save(); render(); });
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible" && (today() !== loadedDay || data?.stale || !data?.items.length)) void refresh();
	});
	const refreshTimer = window.setInterval(() => {
		if (document.visibilityState === "visible" && (today() !== loadedDay || data?.stale || !data?.items.length)) void refresh();
	}, 60000);
	window.addEventListener("beforeunload", () => window.clearInterval(refreshTimer), { once: true });
	await refresh();
}
