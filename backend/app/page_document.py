"""The public congress page as a typed document: a curated set of sections, never free-form markup.

A document only *presents* event data. Ticket tiers, booths, dates and the venue stay operational records;
the `passes` and `exhibitors` sections render whatever those records currently say. Every text slot is a
fa/en pair: the renderer shows the visitor's language, then the other one, then the platform's own copy.
Text is plain text (prose fields allow a small Markdown subset that the client renders without HTML).
Videos are stored as a provider and a checked video id, links as a checked http(s)/mailto/tel address,
colours as curated tokens (or one AA-legible custom accent): the document never carries markup or a raw
embed address.
"""

import re
import uuid
from typing import Annotated, Literal, Union
from urllib.parse import urlsplit

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

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


Accent = Literal["auto", "indigo", "magenta", "azure", "violet", "orchid", "custom"]
HeroLayout = Literal["signature", "banner", "cover", "split"]
HighlightIcon = Literal[
    "qr", "booth", "users", "wifi-off", "calendar", "clock", "pin", "ticket", "shield", "activity",
    "globe", "layers", "note", "chart", "device", "mail", "bookmark", "congress", "id-card",
    "utensils", "check-circle", "info",
]
SectionId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,39}$")]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _channel(hex_pair: str) -> float:
    c = int(hex_pair, 16) / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def contrast_on_white(color: str) -> float:
    """WCAG contrast ratio of `#RRGGBB` against white."""
    r, g, b = (_channel(color[i : i + 2]) for i in (1, 3, 5))
    luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return 1.05 / (luminance + 0.05)


# Accent text sits on white and on its own light tint: AA for normal text.
MIN_ACCENT_CONTRAST = 4.5


class Branding(Strict):
    accent: Accent = "auto"
    # Used when accent is "custom": `#RRGGBB`, legible on white (the studio darkens a pick that is not).
    accent_color: Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")] | None = None
    logo_asset_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _custom_accent(self) -> "Branding":
        if self.accent == "custom":
            if self.accent_color is None:
                raise ValueError("A custom accent needs accent_color")
            if contrast_on_white(self.accent_color) < MIN_ACCENT_CONTRAST:
                raise ValueError("accent_color is not legible on white (WCAG AA needs 4.5:1)")
        return self


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


_PHONE = re.compile(r"^\+?[0-9][0-9 ()-]{2,30}$")
_EMAIL = re.compile(r"^[^@\s/?#]+@[^@\s/?#]+\.[^@\s/?#]+$")


def _check_link(value: str) -> str:
    """An address a visitor can follow: http(s) with a host, mailto: an address, tel: a number. Empty = none."""
    value = _clean(value)
    if not value:
        return value
    scheme, _, rest = value.partition(":")
    scheme = scheme.lower()
    if scheme == "tel" and _PHONE.match(rest):
        return value
    if any(ch.isspace() for ch in value):
        raise ValueError("A link cannot contain spaces")
    if scheme in ("http", "https") and urlsplit(value).hostname:
        return value
    if scheme == "mailto" and _EMAIL.match(rest):
        return value
    raise ValueError("Links must be http(s), mailto: or tel: addresses")


LinkUrl = Annotated[str, Field(max_length=500), AfterValidator(_check_link)]


class SectionStyle(Strict):
    """Curated presentation of one section: tokens, never CSS, so every combination stays legible."""

    background: Literal["none", "subtle", "accent", "ink"] = "none"
    width: Literal["normal", "narrow"] = "normal"
    align: Literal["start", "center"] = "start"
    text_size: Literal["sm", "md", "lg"] = "md"
    # auto: each paragraph follows its own script; rtl/ltr force the whole section.
    direction: Literal["auto", "rtl", "ltr"] = "auto"


class _Section(Strict):
    id: SectionId
    visible: bool = True
    eyebrow: LocalizedLabel = Field(default_factory=_label)
    title: LocalizedLabel = Field(default_factory=_label)
    style: SectionStyle = Field(default_factory=SectionStyle)


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
    # columns: the text flows in two newspaper columns on wide screens.
    layout: Literal["split", "centered", "columns"] = "split"
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
    target: Literal["passes", "exhibitors", "url"] = "passes"
    # target "url": where the button opens (a form, a channel, another site). Until it is filled in, the band
    # shows no button, like a passes target with nothing to reserve.
    url: LinkUrl = ""


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


class ColumnItem(Strict):
    icon: HighlightIcon | None = None
    image_asset_id: uuid.UUID | None = None
    image_alt: LocalizedLabel = Field(default_factory=_label)
    title: LocalizedLabel = Field(default_factory=_label)
    body: LocalizedProse = Field(default_factory=_prose)
    button_label: LocalizedLabel = Field(default_factory=_label)
    button_url: LinkUrl = ""


class ColumnsSection(_Section):
    """Two to four texts side by side (stacked on phones)."""

    type: Literal["columns"] = "columns"
    # wide_start / wide_end: with two columns, one takes two thirds of the row.
    layout: Literal["equal", "wide_start", "wide_end"] = "equal"
    surface: Literal["plain", "cards"] = "plain"
    items: Annotated[list[ColumnItem], Field(max_length=4)] = Field(default_factory=list)


VideoProvider = Literal["youtube", "aparat"]
_VIDEO_IDS = {
    "youtube": re.compile(r"^[A-Za-z0-9_-]{11}$"),
    "aparat": re.compile(r"^[A-Za-z0-9]{3,24}$"),
}


class VideoSection(_Section):
    """An embedded YouTube or Aparat video. Only the id is stored; the page builds the embed address itself
    and loads the player when the visitor presses play."""

    type: Literal["video"] = "video"
    # full: the player across the section. video_start / video_end: beside the text on wide screens.
    layout: Literal["full", "video_start", "video_end"] = "full"
    provider: VideoProvider = "aparat"
    video_id: Annotated[str, Field(max_length=24)] = ""
    poster_asset_id: uuid.UUID | None = None
    caption: LocalizedLine = Field(default_factory=_line)
    body: LocalizedProse = Field(default_factory=_prose)

    @model_validator(mode="after")
    def _known_id(self) -> "VideoSection":
        if self.video_id and not _VIDEO_IDS[self.provider].match(self.video_id):
            raise ValueError(f"'{self.video_id}' is not a {self.provider} video id")
        return self


class GalleryItem(Strict):
    image_asset_id: uuid.UUID | None = None
    alt: LocalizedLabel = Field(default_factory=_label)
    caption: LocalizedLabel = Field(default_factory=_label)
    url: LinkUrl = ""


class GallerySection(_Section):
    """Photos (grid) or a sponsor and partner wall (logos), each optionally linked."""

    type: Literal["gallery"] = "gallery"
    layout: Literal["grid", "logos"] = "grid"
    columns: Literal[2, 3, 4] = 3
    items: Annotated[list[GalleryItem], Field(max_length=24)] = Field(default_factory=list)


LinkKind = Literal[
    "website", "telegram", "instagram", "whatsapp", "eitaa", "bale", "rubika", "linkedin", "x",
    "youtube", "aparat", "email", "phone",
]


class LinkItem(Strict):
    kind: LinkKind = "website"
    url: LinkUrl = ""
    # Empty label: the platform names the channel ("Telegram channel").
    label: LocalizedLabel = Field(default_factory=_label)


class LinksSection(_Section):
    """Community, channel and contact links."""

    type: Literal["links"] = "links"
    layout: Literal["buttons", "cards"] = "buttons"
    lead: LocalizedLine = Field(default_factory=_line)
    items: Annotated[list[LinkItem], Field(max_length=12)] = Field(default_factory=list)


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
        ColumnsSection,
        VideoSection,
        GallerySection,
        LinksSection,
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
            elif isinstance(section, ColumnsSection):
                found.update(item.image_asset_id for item in section.items)
            elif isinstance(section, VideoSection):
                found.add(section.poster_asset_id)
            elif isinstance(section, GallerySection):
                found.update(item.image_asset_id for item in section.items)
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
