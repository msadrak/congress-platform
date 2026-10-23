"""Server-rendered <head> metadata for public congress URLs, for crawlers and link previews that do not run
JavaScript. Only published Page Studio content is used; everything is HTML-escaped, braces included (see `e`).
Unknown or unpublished pages get the platform defaults plus `noindex`, indistinguishable from each other."""

import re
from html import escape

from app.page_document import PageDocument, _Localized as LocalizedText

DEFAULT_TITLE = "AI Teb Congress Platform"
DEFAULT_DESCRIPTION = (
    "AI Teb congress platform: registration, digital passes, gate scanning, reception and exhibitor lead capture."
)
_PERSIAN = re.compile(r"[\u0600-\u06FF]")


def page_language(document: PageDocument, event_name: str) -> str:
    if document.primary_locale != "auto":
        return document.primary_locale
    return "fa" if _PERSIAN.search(event_name) else "en"


def pick(text: LocalizedText, lang: str) -> str:
    first, second = (text.fa, text.en) if lang == "fa" else (text.en, text.fa)
    return (first or second).strip()


def _clip(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


_TEMPLATE_DELIMITERS = str.maketrans({"{": "&#123;", "}": "&#125;"})


def e(value: str) -> str:
    """HTML-escaped, and with braces as character references: the web server includes this head into the
    page shell through its template engine, which would execute organizer text such as `{{env "HOME"}}`."""
    return escape(value, quote=True).translate(_TEMPLATE_DELIMITERS)


def render_head(
    *,
    title: str,
    description: str,
    url: str | None,
    image_url: str | None,
    lang: str | None,
    indexable: bool,
) -> str:
    title = _clip(title, 120)
    description = _clip(description, 300)
    tags = [
        f"<title>{e(title)}</title>",
        f'<meta name="description" content="{e(description)}" />',
        f'<meta property="og:title" content="{e(title)}" />',
        f'<meta property="og:description" content="{e(description)}" />',
        '<meta property="og:type" content="website" />',
        '<meta property="og:site_name" content="AI Teb Congress Platform" />',
        f'<meta name="twitter:card" content="{"summary_large_image" if image_url else "summary"}" />',
    ]
    if lang:
        tags.append(f'<meta property="og:locale" content="{"fa_IR" if lang == "fa" else "en_US"}" />')
    if url:
        tags.append(f'<meta property="og:url" content="{e(url)}" />')
        tags.append(f'<link rel="canonical" href="{e(url)}" />')
    if image_url:
        tags.append(f'<meta property="og:image" content="{e(image_url)}" />')
    if not indexable:
        tags.append('<meta name="robots" content="noindex" />')
    return "\n    ".join(tags)


def default_head() -> str:
    return render_head(
        title=DEFAULT_TITLE, description=DEFAULT_DESCRIPTION, url=None, image_url=None, lang=None, indexable=False
    )
