from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    HRFlowable,
    Image,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path("/Users/yuri.bucio/Personal/with")
OUTPUT_DIR = ROOT / "output" / "pdf"
OUTPUT_PDF = OUTPUT_DIR / "conxion-stakeholder-overview.pdf"
OUTPUT_MD = OUTPUT_DIR / "conxion-stakeholder-overview.md"
LOGO = ROOT / "public" / "branding" / "conxion-logo.png"
GENERATED_ON = date(2026, 5, 21)


CYAN = colors.HexColor("#66F2FF")
FUCHSIA = colors.HexColor("#DB4DFF")
INK = colors.HexColor("#10131A")
SLATE = colors.HexColor("#4B5565")
TEXT = colors.HexColor("#1C2431")
LIGHT = colors.HexColor("#F6F8FC")
DIVIDER = colors.HexColor("#D8E0EA")
RED = colors.HexColor("#FF7B73")


@dataclass
class Section:
    title: str
    paragraphs: list[str]
    bullets: list[str] | None = None


SECTIONS: list[Section] = [
    Section(
        "Executive summary",
        [
            "ConXion is a trust-first web platform for the global dance community. It combines discovery, structured requests, activity coordination, messaging, trust signals, and professional tools in one product instead of forcing members to split their planning across Instagram, WhatsApp, event chats, spreadsheets, and disconnected booking tools.",
            "The current product is organized around four high-value behaviors: finding the right people, coordinating real activities, building trust through completed interactions, and converting professional or organizer demand into structured requests instead of informal chat noise.",
            "For stakeholders, the key point is that ConXion is not a generic social network. It is a vertical coordination layer for dancers, travellers, teachers, hosts, and organizers, with monetization tied to trust access, visibility, and higher-usage operational workflows.",
        ],
    ),
    Section(
        "Who the app is for",
        [
            "The core audience is social dancers and dance travellers who need more context before they connect. Around that core, the platform also supports teachers, artists, DJs, organizers, hosts, and small local communities that need a cleaner way to coordinate classes, trips, events, and hosting.",
        ],
        bullets=[
            "Social dancers looking for practice, events, and trusted local connections",
            "Travellers coordinating festivals, dance holidays, and hosting stays",
            "Teachers and artists presenting services, availability, and booking options",
            "Organizers creating events, handling invites, and managing event participation",
            "Private communities that want a members-only group space tied to the same trust layer",
        ],
    ),
    Section(
        "Main product areas",
        [
            "The current codebase exposes a broad but coherent set of user-facing modules. They work as one system rather than as isolated tools.",
        ],
        bullets=[
            "Discovery and connections: browse dancers, travellers, hosts, and specialized profiles with filters for city, role, trust, and context.",
            "Messages: one-to-one, event, group, and request-driven conversations, with request context, archive, pinning, mute, search, and trust-oriented side panels.",
            "Activity hub: a single area for events, trips, groups, and hosting so members can manage what they created, joined, requested, or archived.",
            "Events: public events, request-based events, and private-group mode built on shared event infrastructure.",
            "Trips and hosting: structured trip creation, join-trip requests, hosting offers, hosting requests, and travel-specific chat context.",
            "Profiles: public social profiles, trust indicators, references, media, and optional teacher profile mode.",
            "Teacher tools: availability, classes, event presence, inquiry handling, and structured private-class booking.",
            "References and trust: relationship-aware reference prompts, activity-based trust eligibility, and visible interaction history.",
            "Notifications and support: in-app notices, request tracking, moderation hooks, help center, safety center, and support flows.",
            "Commercial layer: Starter, Verified, and Plus plans with plan-aware limits and upgrade paths across the app.",
        ],
    ),
    Section(
        "Core user journeys",
        [
            "The strongest current flows are built around intent. Members are not only chatting; they are coordinating a concrete context such as a trip, hosting stay, event, practice session, private class, or group.",
        ],
        bullets=[
            "Connection flow: a member discovers another member, sends a connection request, and after acceptance can use the shared thread as the base for later activity requests.",
            "Trip flow: a traveller creates a trip, other members join it through structured reasons, and accepted trip context remains attached to the same relationship thread.",
            "Hosting flow: a host can offer hosting, or a verified traveller can request hosting. The request carries dates and participant context so future trust is attached to the correct stay.",
            "Event flow: an organizer creates an event, controls access, sends invites, manages visibility and guest settings, and gains a dedicated event thread.",
            "Group flow: a member creates or joins a private group that reuses event infrastructure for membership and discussion logic rather than creating a completely separate system.",
            "Teacher flow: a verified teacher exposes services, classes, availability, and booking requests so students can request a session without fragmented back-and-forth.",
        ],
    ),
    Section(
        "Trust and safety model",
        [
            "Trust is not treated as a vanity metric. The product separates accepted activities, interaction counts, and written references so repeated real experiences can still matter without letting members spam public endorsements.",
            "References unlock after completed activities, not merely after a connection starts. Cooldowns and one-reference-per-completed-activity rules vary by context to keep trust signals meaningful.",
        ],
        bullets=[
            "Practice and Social Dance share a 120-day reference cooldown per pair.",
            "Private Class uses a 90-day reference cooldown per pair.",
            "Travelling, Request Hosting, Offer Hosting, Event/Festival, and Collaborate can generate one reference per completed activity.",
            "Completed activities also create interaction counts that appear separately from written references.",
            "The platform includes blocking, reporting, moderation case handling, support tickets, and a dedicated safety center.",
        ],
    ),
    Section(
        "Messaging, notifications, and operational context",
        [
            "Messages are a core operating layer, not just a chat feature. Threads carry relationship context, request state, pinned items, event or group details, and request-specific actions. The same thread becomes the operating record for accepted activities over time.",
            "Current event and group message experiences include dedicated side panels with organizer details, participants or attending connections, event or group settings, and message-level controls such as pinning, muting, search, and archive.",
            "Notifications and email are used selectively. For example, event request and join lifecycle messages are wired into email, while membership and thread access are represented inside the app where the long-term relationship context lives.",
        ],
    ),
    Section(
        "Teacher and professional layer",
        [
            "ConXion includes a professional mode for verified members who teach or offer services. The public teacher profile is not only a marketing page; it is an operational funnel that ties directly into inquiries, bookings, and calendar-based availability.",
        ],
        bullets=[
            "Teacher headline, bio, city, language, and travel availability",
            "Regular classes and event teaching presence",
            "Experiences and media showcases",
            "Private class booking requests with time-slot selection",
            "Inquiry management in the member's own account area",
        ],
    ),
    Section(
        "Commercial model and monetization",
        [
            "The commercial design is usage-based and trust-based rather than paywalling the whole platform. This gives ConXion a practical upgrade path for different member intents.",
        ],
        bullets=[
            "Starter: free entry plan for discovery, core messaging, one trip per month, two events per month, and limited trust-building actions.",
            "Verified: one-time trust upgrade that unlocks hosted-travel confidence, hosting requests, and professional profile/inquiry access.",
            "Plus: monthly growth plan that expands requests, chat capacity, trips, events, invites, visibility, and profile/media allowances.",
            "The current implementation already applies plan-aware limits across connection requests, active chats, trips, events, hosting, invitations, and group slots.",
        ],
    ),
    Section(
        "Current plan structure",
        [
            "The present billing logic uses three plans. Values below reflect the current implementation in code as of the generated date of this document.",
        ],
    ),
    Section(
        "What stakeholders should understand",
        [
            "ConXion is already more than a concept prototype. The codebase contains active implementations for discovery, messaging, trips, hosting, events, groups, trust, profiles, teacher workflows, support, pricing, and content. The main product risk is not missing surface area; it is maintaining coherence and quality as the product hardens.",
            "That means stakeholder attention should focus on product clarity, operational quality, and which flows deserve the highest commercial or growth priority, rather than on whether the platform already has enough functional depth to explain to users or partners.",
        ],
        bullets=[
            "The product is strongest where context matters: travel, hosting, events, classes, and trust.",
            "The trust layer is a differentiator because it is tied to completed activity rather than generic social proof.",
            "The activity hub and threaded request model create a clearer record of real interactions than fragmented chat-first tools.",
            "The teacher and organizer features create monetizable professional use cases beyond casual social discovery.",
            "The current architecture already supports multiple upgrade levers: trust access, visibility, higher usage, and professional conversion.",
        ],
    ),
]


def write_source_markdown() -> None:
    lines: list[str] = [
        "# ConXion stakeholder overview",
        "",
        f"Generated: {GENERATED_ON.isoformat()}",
        "",
        "## Overview",
        "",
        "ConXion is a trust-first web platform for the global dance community. It brings discovery, messaging, events, trips, hosting, groups, references, and professional teacher tools into one coordinated system.",
        "",
    ]
    for section in SECTIONS:
        lines.append(f"## {section.title}")
        lines.append("")
        lines.extend(section.paragraphs)
        lines.append("")
        if section.bullets:
            lines.extend([f"- {item}" for item in section.bullets])
            lines.append("")
    OUTPUT_MD.write_text("\n".join(lines), encoding="utf-8")


def get_styles():
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="TitleXL",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=24,
            leading=29,
            textColor=INK,
            alignment=TA_LEFT,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Kicker",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=11,
            textColor=CYAN,
            alignment=TA_LEFT,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Subhead",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=12,
            leading=16,
            textColor=SLATE,
            alignment=TA_LEFT,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="SectionHeading",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=20,
            textColor=INK,
            alignment=TA_LEFT,
            spaceBefore=8,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BodyLarge",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=15,
            textColor=TEXT,
            alignment=TA_LEFT,
            spaceAfter=10,
        )
    )
    styles.add(
        ParagraphStyle(
            name="SmallNote",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=11,
            textColor=SLATE,
            alignment=TA_LEFT,
            spaceAfter=4,
        )
    )
    styles.add(
        ParagraphStyle(
            name="TableCell",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=TEXT,
            alignment=TA_LEFT,
        )
    )
    styles.add(
        ParagraphStyle(
            name="RedDate",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=15,
            textColor=RED,
            alignment=TA_LEFT,
            spaceAfter=4,
        )
    )
    return styles


def add_cover(story: list, styles) -> None:
    if LOGO.exists():
        story.append(Image(str(LOGO), width=56 * mm, height=18 * mm))
    story.append(Spacer(1, 18))
    story.append(Paragraph("Stakeholder overview", styles["Kicker"]))
    story.append(Paragraph("ConXion app and current feature surface", styles["TitleXL"]))
    story.append(
        Paragraph(
            "A product-level summary of what the platform currently does, who it serves, how trust and coordination work, and where monetization already exists in the implementation.",
            styles["Subhead"],
        )
    )
    story.append(Spacer(1, 10))

    overview_table = Table(
        [
            ["Product type", "Vertical social coordination platform for the dance community"],
            ["Primary surface", "Responsive web app"],
            ["Core modules", "Discovery, messages, activity hub, events, trips, hosting, groups, profiles, references, teacher tools"],
            ["Commercial model", "Starter, Verified, Plus"],
            ["Generated", GENERATED_ON.strftime("%B %d, %Y")],
        ],
        colWidths=[42 * mm, 120 * mm],
        hAlign="LEFT",
    )
    overview_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
                ("BOX", (0, 0), (-1, -1), 0.75, DIVIDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, DIVIDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                ("TEXTCOLOR", (0, 0), (-1, -1), TEXT),
            ]
        )
    )
    story.append(overview_table)
    story.append(Spacer(1, 14))
    story.append(
        Paragraph(
            "This document is based on the current codebase and product configuration. It is intended as a practical stakeholder briefing, not a marketing brochure.",
            styles["SmallNote"],
        )
    )
    story.append(PageBreak())


def bullet_list(items: Iterable[str], styles) -> ListFlowable:
    return ListFlowable(
        [
            ListItem(Paragraph(item, styles["BodyLarge"]), leftIndent=0)
            for item in items
        ],
        bulletType="bullet",
        start="circle",
        leftIndent=14,
        bulletFontName="Helvetica-Bold",
        bulletFontSize=8,
        bulletColor=FUCHSIA,
        spaceBefore=2,
        spaceAfter=10,
    )


def add_sections(story: list, styles) -> None:
    for index, section in enumerate(SECTIONS):
        story.append(Paragraph(section.title, styles["SectionHeading"]))
        story.append(HRFlowable(width="100%", thickness=0.6, color=DIVIDER))
        story.append(Spacer(1, 6))
        for paragraph in section.paragraphs:
            story.append(Paragraph(paragraph, styles["BodyLarge"]))
        if section.bullets:
            story.append(bullet_list(section.bullets, styles))

        if section.title == "Current plan structure":
            story.append(plan_table(styles))

        if index in {2, 5, 7}:
            story.append(PageBreak())


def plan_table(styles):
    data = [
        [
            Paragraph("<b>Plan</b>", styles["TableCell"]),
            Paragraph("<b>Commercial role</b>", styles["TableCell"]),
            Paragraph("<b>Current limit highlights</b>", styles["TableCell"]),
        ],
        [
            Paragraph("<b>Starter</b>", styles["TableCell"]),
            Paragraph("Free entry plan for discovery and basic coordination.", styles["TableCell"]),
            Paragraph(
                "10 connection requests/month, 10 active chat threads, 1 trip/month, 5 trip requests/month, 2 events/month, 5 private groups total, 10 event invites/month.",
                styles["TableCell"],
            ),
        ],
        [
            Paragraph("<b>Verified</b>", styles["TableCell"]),
            Paragraph("One-time trust and professional unlock.", styles["TableCell"]),
            Paragraph(
                "Verified badge, hosting requests, teacher/artist profile, service inquiries. Starter limits still apply unless the member also has Plus.",
                styles["TableCell"],
            ),
        ],
        [
            Paragraph("<b>Plus</b>", styles["TableCell"]),
            Paragraph("Recurring usage and visibility upgrade.", styles["TableCell"]),
            Paragraph(
                "60 connection requests/month, 30 active chat threads, 5 trips/month, 10 trip requests/month, 5 events/month, 10 private groups total, unlimited event invites, improved discover/event visibility.",
                styles["TableCell"],
            ),
        ],
    ]
    table = Table(data, colWidths=[26 * mm, 48 * mm, 102 * mm], hAlign="LEFT", repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), INK),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [LIGHT, colors.white]),
                ("BOX", (0, 0), (-1, -1), 0.75, DIVIDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, DIVIDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def add_product_snapshot(story: list, styles) -> None:
    story.append(PageBreak())
    story.append(Paragraph("Current implementation snapshot", styles["SectionHeading"]))
    story.append(HRFlowable(width="100%", thickness=0.6, color=DIVIDER))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "The current implementation is already broad enough to support meaningful stakeholder conversations about product-market fit, partnerships, community operations, organizer workflows, trust design, and monetization. The product is no longer a simple MVP screen set; it is a multi-surface community operating system.",
            styles["BodyLarge"],
        )
    )
    story.append(Paragraph("Stakeholder talking points", styles["RedDate"]))
    story.append(
        bullet_list(
            [
                "ConXion brings discovery, requests, messaging, trust, and professional use cases closer together than mainstream social channels do.",
                "The product is especially differentiated in trust-sensitive contexts such as hosting, travel, private classes, and repeated real-world community interaction.",
                "The upgrade model is already aligned with behavior: trust unlocks, visibility, higher throughput, and professional conversion.",
                "Groups are implemented as a mode on shared event infrastructure, which reduces product fragmentation and simplifies future moderation and messaging logic.",
                "The platform can support both casual community use and semi-professional organizer or teacher workflows without needing separate products.",
            ],
            styles,
        )
    )


def draw_footer(canvas, doc) -> None:
    canvas.saveState()
    width, _height = A4
    footer_y = 10 * mm
    left = doc.leftMargin
    right = width - doc.rightMargin
    canvas.setStrokeColor(DIVIDER)
    canvas.setLineWidth(0.5)
    canvas.line(left, footer_y + 6, right, footer_y + 6)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(SLATE)
    canvas.drawString(left, footer_y, "ConXion stakeholder overview")
    page_text = f"Page {doc.page}"
    canvas.drawRightString(right, footer_y, page_text)
    canvas.restoreState()


def build_pdf() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    styles = get_styles()
    story: list = []
    add_cover(story, styles)
    add_sections(story, styles)
    add_product_snapshot(story, styles)

    doc = SimpleDocTemplate(
        str(OUTPUT_PDF),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title="ConXion stakeholder overview",
        author="OpenAI Codex",
    )
    doc.build(story, onFirstPage=draw_footer, onLaterPages=draw_footer)


def main() -> None:
    write_source_markdown()
    build_pdf()
    print(OUTPUT_PDF)
    print(OUTPUT_MD)


if __name__ == "__main__":
    main()
