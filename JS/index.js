function navMenuClick() {
	var x = document.getElementsByClassName("navMenu");
	x[0].classList.toggle("openMenu");
}
window.onscroll = function () {
	scrollFunction();
};
function scrollFunction() {
	if (
		document.documentElement.scrollTop > 50 &&
		!document
			.getElementById("headerTop")
			.classList.contains("headerScrolled")
	) {
		document.getElementById("headerTop").classList.add("headerScrolled");
	} else if (
		document.documentElement.scrollTop <= 50 &&
		document
			.getElementById("headerTop")
			.classList.contains("headerScrolled")
	) {
		document.getElementById("headerTop").classList.remove("headerScrolled");
	}
	if (
		document.documentElement.scrollTop >=
		document.getElementById("home-section").offsetTop
	) {
		//home
		toggleNavItemUnderline(0);
	}
	if (
		document.documentElement.scrollTop >
		document.getElementById("about-section").offsetTop -
			window.innerHeight * 0.15
	) {
		//about me
		toggleNavItemUnderline(1);
	}
	if (
		document.documentElement.scrollTop >
		document.getElementById("projects-section").offsetTop -
			window.innerHeight * 0.15
	) {
		// projects
		toggleNavItemUnderline(2);
	}
	if (
		document.documentElement.scrollTop >
		document.getElementById("contact-section").offsetTop -
			window.innerHeight * 0.15
	) {
		// contact me
		toggleNavItemUnderline(3);
	}
}
function toggleNavItemUnderline(index) {
	var navItems = document.getElementsByClassName("navItem");
	for (var i = 0; i < navItems.length; i++) {
		if (i == index && !navItems[i].classList.contains("current")) {
			navItems[i].classList.add("current");
		} else if (i != index && navItems[i].classList.contains("current")) {
			navItems[i].classList.remove("current");
		}
	}
}
function navItemColourChange(item) {
	item.style.color = "#010101";
}
function navItemColourRevert(item) {
	item.style.color = "#ffffff";
}
