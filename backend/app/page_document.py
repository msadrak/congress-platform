"""The public congress page as a typed document: a curated set of sections, never free-form markup.

A document only *presents* event data. Ticket tiers, booths, dates and the venue stay operational records;
the `passes` and `exhibitors` sections render whatever those records currently say. Every text slot is a
fa/en pair: the renderer shows the visitor's language, then the other one, then the platform's own copy.
Text is plain text (prose fields allow a small Markdown subset that the client renders without HTML).
"""

import re
import uuid
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

MAX_SECTIONS = 24

# C0/C1 control characters other than tab and newline never belong in page text.
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")


def _clean(value: str) -> str:
    return _CONTROL.sub("", value.replace("\r\n", "\n").replace("\r", "\n")).strip()


class _Localized(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fa: str = ""
    en: str = ""

    @field_validator("fa", "en")
    @classmethod
    def _plain_text(cls, value: str) -> str:
        return _clean(value)

    def is_empty(self) -> bool:
        return not (self.fa or self.en)


class LocalizedLabel(_Localized):
    """Short single-line text: headings, labels, names."""

    fa: Annotated[str, Field(max_length=160)] = ""
    en: Annotated[str, Field(max_length=160)] = ""


class LocalizedLine(_Localized):
    """A sentence or two: subtitles, leads, short descriptions."""

    fa: Annotated[str, Field(max_length=500)] = ""
    en: Annotated[str, Field(max_length=500)] = ""


class LocalizedProse(_Localized):
    """Paragraphs with the Markdown-lite subset (blank-line paragraphs, `- ` lists, **bold**, https links)."""

    fa: Annotated[str, Field(max_length=8000)] = ""
    en: Annotated[str, Field(max_length=8000)] = ""


def _label() -> LocalizedLabel:
    return LocalizedLabel()


def _line() -> LocalizedLine:
    return LocalizedLine()


def _prose() -> LocalizedProse:
    return LocalizedProse()


Accent = Literal["auto", "indigo", "magenta", "azure", "violet", "orchid"]
HeroLayout = Literal["signature", "banner", "cover", "split"]
HighlightIcon = Literal[
    "qr", "booth", "users", "wifi-off", "calendar", "clock", "pin", "ticket", "shield", "activity",
    "globe", "layers", "note", "chart", "device", "mail", "bookmark", "congress", "id-card",
    "utensils", "check-circle", "info",
]
SectionId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,39}$")]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Branding(Strict):
    accent: Accent = "auto"
    logo_asset_id: uuid.UUID | None = None


# Where the subject of a cropped hero image sits, in percent of its width and height (CSS object-position).
FocalPercent = Annotated[int, Field(ge=0, le=100)]


class Hero(Strict):
    # signature: generative artwork, no image. banner: the whole image at its own proportions above the
    # title, never cropped. cover: the image fills the hero behind a scrim (cropped to the screen, around the
    # focal point). split: a framed image beside the title (above it on small screens).
    layout: HeroLayout = "signature"
    eyebrow: LocalizedLabel = Field(default_factory=_label)
    # Empty title means the event name (an operational field, live immediately).
    title: LocalizedLine = Field(default_factory=_line)
    subtitle: LocalizedLine = Field(default_factory=_line)
    cta_label: LocalizedLabel = Field(default_factory=_label)
    cover_asset_id: uuid.UUID | None = None
    focal_x: FocalPercent = 50
    focal_y: FocalPercent = 50
    # Cover layout only: a separately composed (usually portrait) image for narrow screens.
    mobile_cover_asset_id: uuid.UUID | None = None


class Seo(Strict):
    title: LocalizedLabel = Field(default_factory=_label)
    description: LocalizedLine = Field(default_factory=_line)
    share_image_asset_id: uuid.UUID | None = None


class _Section(Strict):
    id: SectionId
    visible: bool = True
    eyebrow: LocalizedLabel = Field(default_factory=_label)
    title: LocalizedLabel = Field(default_factory=_label)


class AboutSection(_Section):
    type: Literal["about"] = "about"
    # Empty body means the event description (an operational field, live immediately).
    body: LocalizedProse = Field(default_factory=_prose)


class HighlightItem(Strict):
    icon: HighlightIcon = "check-circle"
    title: LocalizedLabel = Field(default_factory=_label)
    body: LocalizedLine = Field(default_factory=_line)


class HighlightsSection(_Section):
    type: Literal["highlights"] = "highlights"
    layout: Literal["list", "cards"] = "list"
    items: Annotated[list[HighlightItem], Field(max_length=8)] = Field(default_factory=list)


class PassesSection(_Section):
    type: Literal["passes"] = "passes"
    lead: LocalizedLine = Field(default_factory=_line)


class ExhibitorsSection(_Section):
    type: Literal["exhibitors"] = "exhibitors"
    lead: LocalizedLine = Field(default_factory=_line)


class RichTextSection(_Section):
    type: Literal["rich_text"] = "rich_text"
    layout: Literal["split", "centered"] = "split"
    body: LocalizedProse = Field(default_factory=_prose)


class ImageTextSection(_Section):
    type: Literal["image_text"] = "image_text"
    layout: Literal["image_start", "image_end"] = "image_start"
    body: LocalizedProse = Field(default_factory=_prose)
    image_asset_id: uuid.UUID | None = None
    image_alt: LocalizedLabel = Field(default_factory=_label)


class FaqItem(Strict):
    question: LocalizedLine = Field(default_factory=_line)
    answer: LocalizedProse = Field(default_factory=_prose)


class FaqSection(_Section):
    type: Literal["faq"] = "faq"
    items: Annotated[list[FaqItem], Field(max_length=24)] = Field(default_factory=list)


class CtaSection(_Section):
    type: Literal["cta"] = "cta"
    layout: Literal["ink", "accent"] = "ink"
    body: LocalizedLine = Field(default_factory=_line)
    button_label: LocalizedLabel = Field(default_factory=_label)
    target: Literal["passes", "exhibitors"] = "passes"


class Speaker(Strict):
    name: LocalizedLabel = Field(default_factory=_label)
    role: LocalizedLabel = Field(default_factory=_label)
    affiliation: LocalizedLabel = Field(default_factory=_label)
    photo_asset_id: uuid.UUID | None = None


class SpeakersSection(_Section):
    type: Literal["speakers"] = "speakers"
    lead: LocalizedLine = Field(default_factory=_line)
    items: Annotated[list[Speaker], Field(max_length=32)] = Field(default_factory=list)


class AgendaItem(Strict):
    # Free text on purpose ("09:30", "Day 2 · Morning"): editorial content, not a schedule model.
    time: Annotated[str, Field(max_length=40)] = ""
    title: LocalizedLine = Field(default_factory=_line)
    detail: LocalizedLine = Field(default_factory=_line)

    @field_validator("time")
    @classmethod
    def _plain_time(cls, value: str) -> str:
        return _clean(value)


class AgendaSection(_Section):
    type: Literal["agenda"] = "agenda"
    lead: LocalizedLine = Field(default_factory=_line)
    items: Annotated[list[AgendaItem], Field(max_length=48)] = Field(default_factory=list)


PageSection = Annotated[
    Union[
        AboutSection,
        HighlightsSection,
        PassesSection,
        ExhibitorsSection,
        RichTextSection,
        ImageTextSection,
        FaqSection,
        CtaSection,
        SpeakersSection,
        AgendaSection,
    ],
    Field(discriminator="type"),
]

# Bound to event data: always present exactly once. They can be hidden, never removed.
CORE_SECTION_TYPES = ("about", "passes", "exhibitors")


class PageDocument(Strict):
    version: Literal[1] = 1
    # Page language when the visitor has not chosen one; "auto" follows the script of the event name.
    primary_locale: Literal["auto", "fa", "en"] = "auto"
    branding: Branding = Field(default_factory=Branding)
    hero: Hero = Field(default_factory=Hero)
    seo: Seo = Field(default_factory=Seo)
    sections: Annotated[list[PageSection], Field(max_length=MAX_SECTIONS)]

    @model_validator(mode="after")
    def _structure(self) -> "PageDocument":
        ids = [section.id for section in self.sections]
        if len(ids) != len(set(ids)):
            raise ValueError("Section ids must be unique")
        for core in CORE_SECTION_TYPES:
            count = sum(1 for section in self.sections if section.type == core)
            if count != 1:
                raise ValueError(f"The page must contain exactly one '{core}' section (hide it instead of removing it)")
        return self

    def asset_ids(self) -> set[uuid.UUID]:
        """Every image the document references, wherever it is used."""
        found = {
            self.branding.logo_asset_id,
            self.hero.cover_asset_id,
            self.hero.mobile_cover_asset_id,
            self.seo.share_image_asset_id,
        }
        for section in self.sections:
            if isinstance(section, ImageTextSection):
                found.add(section.image_asset_id)
            elif isinstance(section, SpeakersSection):
                found.update(item.photo_asset_id for item in section.items)
        return {asset_id for asset_id in found if asset_id is not None}


def default_page_document() -> PageDocument:
    """What every new event starts with, and what existing events were given on migration: the page as
    it looked before Page Studio. Empty titles fall back to the platform's own localized headings."""
    benefits = [
        ("qr", "Digital QR Pass", "Instant high-contrast badge for seamless check-in at venue gates.",
         "کارت ورود دیجیتال QR", "نشان پرکنتراست برای پذیرش سریع در گیت‌های ورود."),
        ("booth", "Exhibition Access", "Discover participating company booths and download digital brochures.",
         "دسترسی به نمایشگاه", "غرفه‌های شرکت‌های حاضر را ببینید و بروشورهای دیجیتال را دریافت کنید."),
        ("users", "Peer Networking", "Connect with fellow delegates and download vCards directly.",
         "شبکه‌سازی", "با دیگر شرکت‌کنندگان ارتباط بگیرید و کارت ویزیت دیجیتال آن‌ها را دریافت کنید."),
        ("wifi-off", "Offline Pass Access", "Passes stay saved in your personal device browser for fast entry.",
         "دسترسی آفلاین", "کارت ورود در مرورگر دستگاه شما ذخیره می‌ماند تا ورود سریع باشد."),
    ]
    return PageDocument(
        sections=[
            AboutSection(id="about"),
            HighlightsSection(
                id="highlights",
                items=[
                    HighlightItem(
                        icon=icon,
                        title=LocalizedLabel(en=en_title, fa=fa_title),
                        body=LocalizedLine(en=en_body, fa=fa_body),
                    )
                    for icon, en_title, en_body, fa_title, fa_body in benefits
                ],
            ),
            PassesSection(id="passes"),
            ExhibitorsSection(id="exhibitors"),
        ]
    )
