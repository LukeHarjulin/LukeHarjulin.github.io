/* Function navMenuClick()
	- This function executes when the burger menu in the mobile version of the webpage is toggled.
	- It toggles a class name to display/close a navigation menu
 */
function navMenuClick() {
	var x = document.getElementsByClassName("navMenu");
	x[0].classList.toggle("openMenu");
}
window.onscroll = function () {
	scrollFunction();
};
/* Function scrollFunction()
	- On window scroll event, this function checks the viewport and adjusts the header at the top of the webpage accordingly
	- The first if.. else if toggles the colour scheme of the header according to the viewport
	- The remaining if.. else if's determine which section of the webpage the user is at, then calls a function accordingly
*/
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
		document.documentElement.scrollTop >
		document.getElementById("contact-section").offsetTop -
			window.innerHeight * 0.15
	) {
		// contact me
		toggleNavItemUnderline(3);
	} else if (
		document.documentElement.scrollTop >
		document.getElementById("projects-section").offsetTop -
			window.innerHeight * 0.15
	) {
		// projects
		toggleNavItemUnderline(2);
	} else if (
		document.documentElement.scrollTop >
		document.getElementById("about-section").offsetTop -
			window.innerHeight * 0.15
	) {
		//about me
		toggleNavItemUnderline(1);
	} else if (
		document.documentElement.scrollTop >=
		document.getElementById("home-section").offsetTop
	) {
		//home
		toggleNavItemUnderline(0);
	}
}
/* Function toggleNavItemUnerline(index)
	- Adds/Removes a class name which causes the underline of the navigation item to be thickened
	- Called from scrollFunction()
	- parameter "index" refers to the index of the nav item that needs a thicker underline
*/
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
