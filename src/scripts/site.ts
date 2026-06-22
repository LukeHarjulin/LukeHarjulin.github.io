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
