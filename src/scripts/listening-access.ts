import { startListeningDashboard } from "./listening-dashboard";

export function initializeListeningAccess(): void {
	const gate = document.querySelector<HTMLElement>("#listening-access");
	const dashboard = document.querySelector<HTMLElement>("#listening-dashboard");
	const form = document.querySelector<HTMLFormElement>("#listening-login");
	const input = document.querySelector<HTMLInputElement>("#listening-passphrase");
	const submit = document.querySelector<HTMLButtonElement>("#listening-unlock");
	const status = document.querySelector<HTMLElement>("#listening-access-status");
	const lock = document.querySelector<HTMLButtonElement>("#listening-lock");
	const show = document.querySelector<HTMLButtonElement>("#listening-show-passphrase");
	if (!gate || !dashboard || !form || !input || !submit || !status || !lock || !show) return;
	const base = document.querySelector<HTMLElement>("#listening-section")?.dataset.apiBase?.trim().replace(/\/$/, "");
	const initialDashboard = dashboard.innerHTML;
	let dataController: AbortController | undefined;
	let authController = new AbortController();
	let expiryTimer: number | undefined;
	let logoutPending = false;
	try { logoutPending = sessionStorage.getItem("listening-logout-pending") === "true"; } catch { /* Storage is optional. */ }
	function setLogoutPending(value: boolean) {
		logoutPending = value;
		try {
			if (value) sessionStorage.setItem("listening-logout-pending", "true");
			else sessionStorage.removeItem("listening-logout-pending");
		} catch { /* The in-memory marker still prevents reopening this page. */ }
	}

	function hideData(message: string): void {
		dataController?.abort();
		dataController = undefined;
		window.clearTimeout(expiryTimer);
		dashboard!.hidden = true;
		dashboard!.innerHTML = initialDashboard;
		lock!.hidden = true;
		gate!.hidden = false;
		status!.textContent = message;
	}

	function resetAuth(): AbortSignal {
		authController.abort();
		authController = new AbortController();
		return authController.signal;
	}

	async function auth(path: string, signal: AbortSignal, body?: object) {
		if (!base) throw new Error("Listening access is not configured yet.");
		const response = await fetch(`${base}/api/auth/${path}`, {
			method: body ? "POST" : "GET", credentials: "include", cache: "no-store", signal,
			headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
			body: body ? JSON.stringify(body) : undefined,
		});
		signal.throwIfAborted();
		if (response.status === 401) throw new Error("Incorrect passphrase. Please try again.");
		if (response.status === 429) throw new Error("Too many attempts. Please wait one minute before trying again.");
		if (!response.ok) throw new Error("Listening access is temporarily unavailable. Please try again.");
		const payload = await response.json();
		signal.throwIfAborted();
		return payload.data as { authenticated: boolean; expiresAt?: number };
	}

	function unlock(expiresAt: number): void {
		hideData("");
		gate!.hidden = true;
		dashboard!.hidden = false;
		lock!.hidden = false;
		dataController = new AbortController();
		const expired = () => {
			hideData("Your session has expired. Enter the passphrase to unlock listening.");
			input!.focus();
		};
		expiryTimer = window.setTimeout(expired, Math.max(0, expiresAt - Date.now()));
		startListeningDashboard(dataController.signal, expired);
	}

	async function checkSession(): Promise<void> {
		const signal = resetAuth();
		hideData("Checking access…");
		submit!.disabled = true;
		try {
			// Retry a failed logout before allowing this page to unlock again.
			if (logoutPending) { await auth("logout", signal, {}); setLogoutPending(false); }
			const session = await auth("session", signal);
			if (session.authenticated && session.expiresAt && session.expiresAt > Date.now()) unlock(session.expiresAt);
			else status!.textContent = "Enter the shared passphrase to view listening stats.";
		} catch (error) {
			if (!signal.aborted) status!.textContent = error instanceof TypeError ? "Could not connect. Check your connection and try unlocking again." : (error as Error).message;
		} finally { if (!signal.aborted) submit!.disabled = false; }
	}

	show.addEventListener("click", () => {
		input.type = input.type === "password" ? "text" : "password";
		show.textContent = input.type === "password" ? "Show" : "Hide";
		show.setAttribute("aria-pressed", String(input.type === "text"));
	});
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const signal = resetAuth();
		submit.disabled = true;
		status.textContent = "Unlocking…";
		const passphrase = input.value;
		input.value = "";
		input.type = "password";
		show.textContent = "Show";
		show.setAttribute("aria-pressed", "false");
		try {
			await auth("login", signal, { passphrase });
			setLogoutPending(false);
			const session = await auth("session", signal);
			if (!session.authenticated || !session.expiresAt || session.expiresAt <= Date.now()) throw new Error("Please allow cookies for this site, then try again.");
			unlock(session.expiresAt);
			lock.focus();
		} catch (error) {
			if (!signal.aborted) {
				status.textContent = error instanceof TypeError ? "Could not connect. Check your connection and try again." : (error as Error).message;
				input.focus();
			}
		} finally { if (!signal.aborted) submit.disabled = false; }
	});
	lock.addEventListener("click", async () => {
		const signal = resetAuth();
		setLogoutPending(true);
		hideData("Locking…");
		submit.disabled = true;
		try {
			await auth("logout", signal, {});
			setLogoutPending(false);
			status.textContent = "Listening is locked.";
		} catch {
			if (!signal.aborted) status.textContent = "Data is hidden, but sign-out could not finish. Reconnect and reload to retry.";
		} finally {
			if (!signal.aborted) { submit.disabled = false; input.focus(); }
		}
	});
	window.addEventListener("pagehide", () => {
		authController.abort();
		input.value = "";
		hideData("Checking access…");
	});
	window.addEventListener("pageshow", (event) => { if (event.persisted) void checkSession(); });
	void checkSession();
}
