function navMenuClick() {
	var x = document.getElementsByClassName("navMenu");
	x[0].classList.toggle("openMenu");
}
window.onscroll = function () {
	scrollFunction();
};
function scrollFunction() {
	if (document.body.scrollTop > 2 || document.documentElement.scrollTop > 2) {
		document.getElementById("headerTop").style.backgroundColor = "#ffb81c";
		if (document.body.clientWidth < 600) {
			document.getElementById("menuList").style.backgroundColor =
				"#ffb81c";
		} else {
			document.getElementById("menuList").style.backgroundColor =
				"transparent";
		}
		var bars = document.getElementsByClassName("menuBar");
		var i = 0;
		for (i = 0; i < 3; i++) {
			bars[i].style.backgroundColor = "#010101";
		}
		document.getElementsByClassName("logo")[0].style.color = "#010101";
		var items = document.getElementsByClassName("navItem");
		for (i = 0; i < items.length; i++) {
			navItemColourChange(items[i]);
		}
	} else {
		document.getElementById("headerTop").style.backgroundColor = "#010101";
		if (document.body.clientWidth < 600) {
			document.getElementById("menuList").style.backgroundColor =
				"#010101";
		} else {
			document.getElementById("menuList").style.backgroundColor =
				"transparent";
		}
		var bars = document.getElementsByClassName("menuBar");
		var i = 0;
		for (i = 0; i < 3; i++) {
			bars[i].style.backgroundColor = "#ffb81c";
		}
		document.getElementsByClassName("logo")[0].style.color = "#ffffff";
		var items = document.getElementsByClassName("navItem");
		for (i = 0; i < items.length; i++) {
			navItemColourRevert(items[i]);
		}
	}
}
function navItemColourChange(item) {
	item.style.color = "#010101";
}
function navItemColourRevert(item) {
	item.style.color = "#ffffff";
}
