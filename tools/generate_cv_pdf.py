from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Sequence

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "src" / "data" / "cv.json"
CV_DATA: dict[str, Any] = json.loads(DATA_PATH.read_text(encoding="utf-8"))
PROFILE = CV_DATA["profile"]
EXPERIENCE = CV_DATA["experience"]
OUTPUT = ROOT / "public" / PROFILE["cv"]["href"].lstrip("/")
CV_VERSION = OUTPUT.stem.replace("Luke-Harjulin-CV-", "")
CV_LABEL = f"CV {CV_VERSION}" if CV_VERSION != OUTPUT.stem else "CV"

PAGE_W, PAGE_H = A4
MARGIN = 42
GUTTER = 22
LEFT_COL = 164
RIGHT_X = MARGIN + LEFT_COL + GUTTER
RIGHT_W = PAGE_W - RIGHT_X - MARGIN

INK = colors.HexColor("#111417")
INK_SOFT = colors.HexColor("#1b2024")
PAPER = colors.HexColor("#f6f1e8")
PAPER_STRONG = colors.HexColor("#fffaf0")
TEXT = colors.HexColor("#1d2428")
MUTED = colors.HexColor("#5f6b70")
INVERSE = colors.HexColor("#fbf7ee")
LINE = colors.HexColor("#d6d1c8")
LINE_DARK = colors.HexColor("#3a3f3f")
GOLD = colors.HexColor("#f0b429")
TEAL = colors.HexColor("#1c8c84")
CORAL = colors.HexColor("#bf5c4a")
TEAL_TINT = colors.HexColor("#e0ece8")
SIDEBAR_TEAL = colors.HexColor("#13302e")
SIDEBAR_TEXT = colors.HexColor("#c9c7bf")
SIDEBAR_TEXT_STRONG = colors.HexColor("#dad5cb")


def register_fonts() -> dict[str, str]:
	return {
		"regular": "Helvetica",
		"bold": "Helvetica-Bold",
		"light": "Helvetica",
	}


FONTS = register_fonts()


def set_font(pdf: canvas.Canvas, weight: str, size: float, color=TEXT) -> None:
	pdf.setFont(FONTS[weight], size)
	pdf.setFillColor(color)


def draw_page_background(pdf: canvas.Canvas) -> None:
	pdf.setFillColor(PAPER)
	pdf.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)


def draw_logo(pdf: canvas.Canvas, x: float, y: float, scale: float = 1.0, light: bool = True) -> None:
	mark = INVERSE if light else INK
	cutout = SIDEBAR_TEAL if light else PAPER
	pdf.setFillColor(mark)
	pdf.rect(x + 50 * scale, y + 78 * scale, 100 * scale, 2 * scale, stroke=0, fill=1)
	pdf.rect(x, y + 8 * scale, 100 * scale, 2 * scale, stroke=0, fill=1)
	pdf.rect(x + 50 * scale, y + 16 * scale, 8 * scale, 55 * scale, stroke=0, fill=1)
	pdf.rect(x + 50 * scale, y + 16 * scale, 40 * scale, 8 * scale, stroke=0, fill=1)
	pdf.rect(x + 70 * scale, y + 33 * scale, 7 * scale, 38 * scale, stroke=0, fill=1)
	pdf.rect(x + 93 * scale, y + 33 * scale, 7 * scale, 38 * scale, stroke=0, fill=1)
	pdf.rect(x + 77 * scale, y + 50 * scale, 16 * scale, 6 * scale, stroke=0, fill=1)
	pdf.saveState()
	pdf.translate(x + 71.5 * scale, y + 52 * scale)
	pdf.rotate(38)
	pdf.setFillColor(cutout)
	pdf.rect(-37.5 * scale, -3 * scale, 75 * scale, 6 * scale, stroke=0, fill=1)
	pdf.restoreState()


def draw_rule(pdf: canvas.Canvas, x: float, y: float, w: float, color=LINE) -> None:
	pdf.setStrokeColor(color)
	pdf.setLineWidth(0.7)
	pdf.line(x, y, x + w, y)


def paragraph(
	pdf: canvas.Canvas,
	text: str,
	x: float,
	y: float,
	w: float,
	size: float = 9.2,
	leading: float = 12.2,
	color=TEXT,
	weight: str = "regular",
	space_after: float = 8,
) -> float:
	set_font(pdf, weight, size, color)
	lines = simpleSplit(text, FONTS[weight], size, w)
	for line in lines:
		pdf.drawString(x, y, line)
		y -= leading
	return y - space_after


def heading(pdf: canvas.Canvas, title: str, x: float, y: float, w: float, dark: bool = False) -> float:
	color = GOLD if dark else TEAL
	set_font(pdf, "bold", 7.6, color)
	pdf.drawString(x, y, title.upper())
	draw_rule(pdf, x, y - 5, w, LINE_DARK if dark else LINE)
	return y - 18


def title_block(
	pdf: canvas.Canvas,
	text: str,
	x: float,
	y: float,
	w: float,
	size: float = 20,
	leading: float = 22,
) -> float:
	set_font(pdf, "bold", size, TEXT)
	lines = simpleSplit(text, FONTS["bold"], size, w)
	for line in lines:
		pdf.drawString(x, y, line)
		y -= leading
	return y - 5


def bullets(
	pdf: canvas.Canvas,
	items: Sequence[str],
	x: float,
	y: float,
	w: float,
	size: float = 8.7,
	leading: float = 11.4,
	color=TEXT,
	accent=TEAL,
	bullet_size: float = 3.2,
	space_after: float = 8,
	text_indent: float = 14,
	item_gap: float = 3,
) -> float:
	for item in items:
		lines = simpleSplit(item, FONTS["regular"], size, w - text_indent)
		pdf.setFillColor(accent)
		pdf.circle(x + 4, y - size * 0.32, bullet_size / 2, stroke=0, fill=1)
		set_font(pdf, "regular", size, color)
		for line in lines:
			pdf.drawString(x + text_indent, y, line)
			y -= leading
		y -= item_gap
	return y - space_after


def pill(pdf: canvas.Canvas, text: str, x: float, y: float, font_size: float = 7.1) -> tuple[float, float]:
	text_w = pdfmetrics.stringWidth(text, FONTS["bold"], font_size)
	w = text_w + 12
	h = 15
	pdf.setFillColor(TEAL_TINT)
	pdf.roundRect(x, y - h + 3, w, h, 4, stroke=0, fill=1)
	set_font(pdf, "bold", font_size, colors.HexColor("#11655f"))
	pdf.drawString(x + 6, y - 7.6, text)
	return w, h


def pills(
	pdf: canvas.Canvas,
	items: Iterable[str],
	x: float,
	y: float,
	w: float,
	gap: float = 5,
	font_size: float = 7.1,
) -> float:
	cursor_x = x
	line_y = y
	for item in items:
		item_w = pdfmetrics.stringWidth(item, FONTS["bold"], font_size) + 12
		if cursor_x + item_w > x + w:
			cursor_x = x
			line_y -= 19
		drawn_w, _ = pill(pdf, item, cursor_x, line_y, font_size)
		cursor_x += drawn_w + gap
	return line_y - 20


def card(pdf: canvas.Canvas, x: float, y: float, w: float, h: float, fill=PAPER_STRONG) -> None:
	pdf.setFillColor(fill)
	pdf.setStrokeColor(LINE)
	pdf.setLineWidth(0.6)
	pdf.roundRect(x, y - h, w, h, 6, stroke=1, fill=1)


def link_text(pdf: canvas.Canvas, label: str, url: str, x: float, y: float, size: float = 8.2) -> float:
	set_font(pdf, "bold", size, INVERSE)
	pdf.drawString(x, y, label)
	text_w = pdfmetrics.stringWidth(label, FONTS["bold"], size)
	pdf.linkURL(url, (x, y - 2, x + text_w, y + size + 2), relative=0)
	return y - 12


def sidebar_list(
	pdf: canvas.Canvas,
	items: Sequence[str],
	x: float,
	y: float,
	w: float,
	size: float = 7.6,
	leading: float = 9.6,
	color=SIDEBAR_TEXT_STRONG,
	gap: float = 5,
) -> float:
	for item in items:
		y = paragraph(pdf, item, x, y, w, size, leading, color, "regular", gap)
	return y


def sector_row(
	pdf: canvas.Canvas,
	x: float,
	y: float,
	w: float,
	h: float,
	title: str,
	role: str,
	summary: str,
	points: Sequence[str],
	tags: Sequence[str],
) -> None:
	card(pdf, x, y, w, h)
	set_font(pdf, "bold", 9.2, TEXT)
	pdf.drawString(x + 13, y - 17, title)
	set_font(pdf, "bold", 7.5, CORAL)
	pdf.drawRightString(x + w - 13, y - 17, role)
	inner_y = paragraph(pdf, summary, x + 13, y - 32, w - 26, 7.45, 9.2, MUTED, "regular", 3)
	bullets(pdf, points, x + 13, inner_y, w - 26, 6.95, 8.7, TEXT, TEAL, 2.5, 0, 13, 1.5)
	pills(pdf, tags, x + 13, y - h + 18, w - 26, 4, 6.1)


def draw_sidebar(pdf: canvas.Canvas, y_top: float, y_bottom: float, page_num: int) -> None:
	pdf.setFillColor(INK)
	pdf.rect(0, 0, MARGIN + LEFT_COL, PAGE_H, stroke=0, fill=1)
	pdf.setFillColor(SIDEBAR_TEAL)
	pdf.rect(0, y_bottom, MARGIN + LEFT_COL, y_top - y_bottom, stroke=0, fill=1)
	draw_logo(pdf, MARGIN, PAGE_H - 84, 0.72, light=True)
	set_font(pdf, "light", 8.4, SIDEBAR_TEXT)
	pdf.drawString(MARGIN, 34, f"{PROFILE['name']} - {CV_LABEL} - Page {page_num}")


def page_one(pdf: canvas.Canvas) -> None:
	draw_page_background(pdf)
	draw_sidebar(pdf, PAGE_H, 0, 1)

	set_font(pdf, "bold", 29, INVERSE)
	pdf.drawString(MARGIN, PAGE_H - 128, PROFILE["firstName"])
	pdf.drawString(MARGIN, PAGE_H - 159, PROFILE["lastName"])
	set_font(pdf, "bold", 9.5, GOLD)
	pdf.drawString(MARGIN, PAGE_H - 182, PROFILE["role"])
	set_font(pdf, "regular", 8.5, SIDEBAR_TEXT_STRONG)
	pdf.drawString(MARGIN, PAGE_H - 199, PROFILE["specialism"])
	pdf.drawString(MARGIN, PAGE_H - 212, PROFILE["location"])

	y = PAGE_H - 252
	y = heading(pdf, "Public links", MARGIN, y, LEFT_COL - 8, dark=True)
	for link in PROFILE["publicLinks"]:
		y = link_text(pdf, link["label"], link["href"], MARGIN, y, 7.2 if "linkedin.com" in link["label"] else 8.2)

	y -= 19
	y = heading(pdf, "At a glance", MARGIN, y, LEFT_COL - 8, dark=True)
	for metric in CV_DATA["metrics"]:
		set_font(pdf, "bold", 18, GOLD)
		pdf.drawString(MARGIN, y, metric["value"])
		y -= 13
		y = paragraph(pdf, metric["label"], MARGIN, y, LEFT_COL - 10, 7.8, 10.2, SIDEBAR_TEXT_STRONG, "regular", 9)

	y = heading(pdf, "Focus", MARGIN, y, LEFT_COL - 8, dark=True)
	y = bullets(
		pdf,
		PROFILE["focus"],
		MARGIN,
		y,
		LEFT_COL - 10,
		7.8,
		10.2,
		SIDEBAR_TEXT_STRONG,
		GOLD,
		3,
		0,
	)

	y = PAGE_H - 64
	set_font(pdf, "bold", 8.6, TEAL)
	pdf.drawString(RIGHT_X, y, "PROFILE")
	y -= 20
	y = title_block(pdf, PROFILE["headline"], RIGHT_X, y, RIGHT_W, 19, 21)
	for index, summary in enumerate(PROFILE["cvSummary"]):
		y = paragraph(pdf, summary, RIGHT_X, y, RIGHT_W, 9.05, 12.2, MUTED, "regular", 10 if index else 8)

	card_h = 82
	card(pdf, RIGHT_X, y, RIGHT_W, card_h)
	set_font(pdf, "bold", 8.6, CORAL)
	pdf.drawString(RIGHT_X + 16, y - 20, PROFILE["platformFocus"]["title"].upper())
	focus_y = paragraph(
		pdf,
		PROFILE["platformFocus"]["description"],
		RIGHT_X + 16,
		y - 38,
		RIGHT_W - 32,
		8.35,
		10.8,
		TEXT,
		"regular",
		4,
	)
	pills(pdf, PROFILE["platformFocus"]["tags"], RIGHT_X + 16, focus_y + 7, RIGHT_W - 32, 5, 6.6)
	y -= card_h + 18

	y = heading(pdf, "Professional experience", RIGHT_X, y, RIGHT_W)
	set_font(pdf, "bold", 14.2, TEXT)
	pdf.drawString(RIGHT_X, y, EXPERIENCE["company"])
	set_font(pdf, "bold", 9.6, TEAL)
	pdf.drawRightString(RIGHT_X + RIGHT_W, y, EXPERIENCE["role"])
	y -= 15
	set_font(pdf, "regular", 8.6, MUTED)
	pdf.drawString(RIGHT_X, y, EXPERIENCE["cvContext"])
	y -= 17
	y = paragraph(
		pdf,
		EXPERIENCE["summary"],
		RIGHT_X,
		y,
		RIGHT_W,
		8.55,
		11.1,
		MUTED,
		"regular",
		10,
	)

	y = heading(pdf, "Sector delivery highlights", RIGHT_X, y, RIGHT_W)
	sector_h = 102
	sector_gap = 6
	for sector in EXPERIENCE["sectorHighlights"]:
		sector_row(
			pdf,
			RIGHT_X,
			y,
			RIGHT_W,
			sector_h,
			sector["title"],
			sector["role"],
			sector["summary"],
			sector["points"],
			sector["tags"],
		)
		y -= sector_h + sector_gap


def impact_card(pdf: canvas.Canvas, x: float, y: float, w: float, h: float, title: str, points: Sequence[str], tags: Sequence[str]) -> None:
	card(pdf, x, y, w, h)
	set_font(pdf, "bold", 8.9, TEXT)
	title_y = y - 18
	for line in simpleSplit(title, FONTS["bold"], 8.9, w - 26):
		pdf.drawString(x + 13, title_y, line)
		title_y -= 10.5
	inner_y = title_y - 6
	bullets(pdf, points, x + 13, inner_y, w - 26, 7.15, 9.2, MUTED, TEAL, 2.6, 3, 13, 1.5)
	pills(pdf, tags, x + 13, y - h + 34, w - 26, 4, 6.7)


def page_two_sidebar_details(pdf: canvas.Canvas) -> None:
	y = PAGE_H - 252
	y = heading(pdf, "Certifications", MARGIN, y, LEFT_COL - 8, dark=True)
	y = sidebar_list(
		pdf,
		[certification["label"] for certification in CV_DATA["certifications"]],
		MARGIN,
		y,
		LEFT_COL - 10,
		7.6,
		9.6,
		SIDEBAR_TEXT_STRONG,
		6,
	)
	y = heading(pdf, "Education", MARGIN, y, LEFT_COL - 8, dark=True)
	y = paragraph(
		pdf,
		f"{CV_DATA['education']['award']}, {CV_DATA['education']['year']}",
		MARGIN,
		y,
		LEFT_COL - 10,
		8,
		10.5,
		SIDEBAR_TEXT_STRONG,
		"regular",
		0,
	)


def page_two(pdf: canvas.Canvas) -> None:
	draw_page_background(pdf)
	draw_sidebar(pdf, PAGE_H, 0, 2)
	page_two_sidebar_details(pdf)

	y = PAGE_H - 64
	set_font(pdf, "bold", 8.6, TEAL)
	pdf.drawString(RIGHT_X, y, "SELECTED IMPACT")
	y -= 20
	y = title_block(pdf, "Automation, cloud migration, developer enablement.", RIGHT_X, y, RIGHT_W, 19, 21)
	y -= 3

	card_w = (RIGHT_W - 12) / 2
	card_h = 134
	for index, impact in enumerate(CV_DATA["impactHighlights"]):
		col = index % 2
		row = index // 2
		x = RIGHT_X + col * (card_w + 12)
		card_y = y - row * (card_h + 13)
		impact_card(pdf, x, card_y, card_w, card_h, impact["title"], impact["points"], impact["tags"])

	y -= 3 * (card_h + 13) + 13
	y = heading(pdf, "Technical toolkit", RIGHT_X, y, RIGHT_W)
	for toolkit in CV_DATA["toolkitRows"]:
		set_font(pdf, "bold", 8.4, TEXT)
		pdf.drawString(RIGHT_X, y, toolkit["label"])
		y = pills(pdf, toolkit["items"], RIGHT_X + 90, y + 5, RIGHT_W - 90, 4)
		y -= 2


def build_pdf() -> None:
	OUTPUT.parent.mkdir(parents=True, exist_ok=True)
	pdf = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=0)
	pdf.setTitle(f"{PROFILE['name']} {CV_LABEL}")
	pdf.setAuthor(PROFILE["name"])
	page_one(pdf)
	pdf.showPage()
	page_two(pdf)
	pdf.save()
	print(OUTPUT)


if __name__ == "__main__":
	build_pdf()
