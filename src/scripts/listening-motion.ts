const preference = matchMedia("(prefers-reduced-motion: reduce)");
let enabled = true;
try { enabled = localStorage.getItem("listening-motion") !== "off"; } catch { /* Optional storage. */ }
const button = document.querySelector<HTMLButtonElement>("[data-motion-toggle]");
function syncMotion() {
	const active = enabled && !preference.matches;
	document.body.dataset.motion = active ? "on" : "off";
	document.body.dataset.hidden = String(document.hidden);
	if (button) {
		button.textContent = `Motion ${active ? "on" : "off"}`;
		button.setAttribute("aria-pressed", String(active));
		button.disabled = preference.matches;
		button.title = preference.matches ? "Motion disabled by your system preference" : "Toggle decorative motion";
	}
	if (!active || document.hidden) document.getAnimations().forEach((animation) => {
		if (animation instanceof CSSAnimation) return;
		animation.cancel();
	});
}
button?.addEventListener("click", () => {
	enabled = !enabled;
	try { localStorage.setItem("listening-motion", enabled ? "on" : "off"); } catch { /* Optional storage. */ }
	syncMotion();
});
preference.addEventListener("change", syncMotion);
document.addEventListener("visibilitychange", syncMotion);
syncMotion();

export function sleeveTransition(element: HTMLElement, signal?: AbortSignal): void {
	if (document.body.dataset.motion !== "on" || document.hidden || signal?.aborted) return;
	element.getAnimations().forEach((animation) => animation.cancel());
	const animation = element.animate([{ opacity: .3, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 220, easing: "ease-out" });
	const cancel = () => animation.cancel();
	signal?.addEventListener("abort", cancel, { once: true });
	animation.finished.catch(() => {}).finally(() => signal?.removeEventListener("abort", cancel));
}
