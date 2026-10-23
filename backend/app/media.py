"""Image intake and storage for Page Studio.

Uploads are decoded and re-encoded server-side: only PNG, JPEG and WebP survive, metadata (EXIF, GPS,
comments) is dropped, orientation is applied, animation is flattened to its first frame and large photos
are scaled down. What is stored is therefore always an image this server produced, never the uploaded
bytes. Files are named by generated ids under `<media_root>/<event_id>/`; no client-supplied name or path
ever reaches the filesystem. The media root is a plain directory so it can be a Docker volume today and be
swapped for object storage behind the same two functions later.
"""

import hashlib
import io
import os
import re
import tempfile
import uuid
import warnings
import zlib
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

ACCEPTED_UPLOAD_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})
MAX_EDGE = 2400
MAX_PIXELS = 40_000_000

_FORMATS: dict[str, tuple[str, str]] = {
    # Pillow format -> (content type, file extension)
    "PNG": ("image/png", "png"),
    "JPEG": ("image/jpeg", "jpg"),
    "WEBP": ("image/webp", "webp"),
}


class RejectedImage(ValueError):
    """The upload is not an acceptable image. The message is safe to show to the organizer."""


@dataclass(frozen=True)
class ProcessedImage:
    data: bytes
    content_type: str
    extension: str
    width: int
    height: int
    sha256: str


def process_image(raw: bytes) -> ProcessedImage:
    """Decode, normalise and re-encode an uploaded image. CPU-bound: run it off the event loop."""
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            with Image.open(io.BytesIO(raw)) as probe:
                source_format = probe.format or ""
                if source_format not in _FORMATS:
                    raise RejectedImage("Only PNG, JPEG and WebP images are accepted.")
                if probe.width * probe.height > MAX_PIXELS:
                    raise RejectedImage("The image has too many pixels.")
                probe.verify()
            with Image.open(io.BytesIO(raw)) as source:
                source.seek(0)
                image = ImageOps.exif_transpose(source)
                image.load()
        except RejectedImage:
            raise
        except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise RejectedImage("The file is not a readable PNG, JPEG or WebP image.") from None
        except (OSError, SyntaxError, ValueError):
            raise RejectedImage("The file is not a readable PNG, JPEG or WebP image.") from None

    image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    content_type, extension = _FORMATS[source_format]
    out = io.BytesIO()
    if source_format == "JPEG":
        image.convert("RGB").save(out, "JPEG", quality=85, optimize=True, progressive=True)
    elif source_format == "PNG":
        mode = "RGBA" if image.mode in ("RGBA", "LA", "P", "PA") else "RGB"
        image.convert(mode).save(out, "PNG", optimize=True)
    else:
        mode = "RGBA" if image.mode in ("RGBA", "LA", "P", "PA") else "RGB"
        image.convert(mode).save(out, "WEBP", quality=85, method=4)
    data = out.getvalue()
    return ProcessedImage(
        data=data,
        content_type=content_type,
        extension=extension,
        width=image.width,
        height=image.height,
        sha256=hashlib.sha256(data).hexdigest(),
    )


PDF_MAGIC = b"%PDF-"
# Names a schedule never needs: scripts, launching programs, embedded files and multimedia, forms (XFA, submit,
# import), automatic actions (/AA) and jumps into other documents. Compared after decoding `#xx` escapes, so
# `/J#61vaScript` is `/JavaScript`. Ordinary web links (/URI) are allowed; their targets are checked below.
_PDF_BLOCKED_NAMES = frozenset(
    {
        b"JavaScript", b"JS", b"Launch", b"EmbeddedFile", b"EmbeddedFiles", b"RichMedia", b"XFA", b"AA",
        b"SubmitForm", b"ImportData", b"GoToR", b"GoToE", b"Rendition", b"Sound", b"Movie",
    }
)
# A name token: a slash and every following byte up to whitespace or a delimiter (PDF 32000-1, 7.3.5).
_PDF_NAME = re.compile(rb"/([^\x00\t\n\f\r ()<>\[\]{}/%]*)")
_PDF_NAME_ESCAPE = re.compile(rb"#([0-9A-Fa-f]{2})")
_PDF_WHITESPACE = b"\x00\t\n\f\r "
# The `stream` keyword that opens a stream's data (not the end of `endstream`).
_PDF_STREAM = re.compile(rb"(?<![A-Za-z])stream\r?\n")
_PDF_PAGE = re.compile(rb"/Type\s*/Page(?![A-Za-z0-9])")
# Object streams hold whole dictionaries compressed; they are inflated and checked too, within this budget.
MAX_PDF_INFLATED_BYTES = 32 * 1024 * 1024
_PDF_DICT_LOOKBACK = 4096


class RejectedPdf(ValueError):
    """The upload is not an acceptable PDF. The message is safe to show to the organizer."""


@dataclass(frozen=True)
class CheckedPdf:
    sha256: str
    # Counted from uncompressed page objects; None when the file keeps them in object streams.
    page_count: int | None


def _pdf_names(data: bytes) -> list[tuple[bytes, int]]:
    """Every name in `data`, `#xx` escapes decoded, with the offset just after it."""
    return [
        (_PDF_NAME_ESCAPE.sub(lambda e: bytes([int(e.group(1), 16)]), m.group(1)), m.end())
        for m in _PDF_NAME.finditer(data)
    ]


# Link targets a schedule may open: web pages, e-mail and phone. Anything else (javascript:, data:, file:, …)
# is refused; a target with no scheme is a relative link and harmless.
_PDF_LINK_SCHEMES = frozenset({b"http", b"https", b"mailto", b"tel"})
_PDF_SCHEME = re.compile(rb"^\s*([A-Za-z][A-Za-z0-9+.\-]*):")


def _pdf_string_at(data: bytes, start: int) -> bytes | None:
    """The literal `( … )` or hex `< … >` string starting at `start` (after whitespace), or None."""
    rest = data[start:].lstrip(_PDF_WHITESPACE)
    if rest[:1] == b"(":
        depth, out, i = 1, bytearray(), 1
        while i < len(rest) and depth:
            c = rest[i : i + 1]
            if c == b"\\":
                out += rest[i + 1 : i + 2]
                i += 2
                continue
            depth += c == b"("
            depth -= c == b")"
            if depth:
                out += c
            i += 1
        return bytes(out)
    if rest[:1] == b"<" and rest[1:2] != b"<":
        end = rest.find(b">")
        digits = re.sub(rb"[^0-9A-Fa-f]", b"", rest[1 : end if end > 0 else len(rest)])
        return bytes.fromhex((digits + b"0" * (len(digits) % 2)).decode())
    return None


def _refuse_active_names(data: bytes) -> None:
    for name, end in _pdf_names(data):
        if name in _PDF_BLOCKED_NAMES:
            raise RejectedPdf(ACTIVE_PDF)
        if name == b"URI":
            target = _pdf_string_at(data, end)
            scheme = _PDF_SCHEME.match(target) if target is not None else None
            if scheme is not None and scheme.group(1).lower() not in _PDF_LINK_SCHEMES:
                raise RejectedPdf(ACTIVE_PDF)
        # A document-open action is accepted only as an explicit destination (`[page /Fit]`), which merely sets
        # the first view; a dictionary or a reference can be an action.
        if name == b"OpenAction" and data[end:].lstrip(_PDF_WHITESPACE)[:1] != b"[":
            raise RejectedPdf(ACTIVE_PDF)


def _object_streams(raw: bytes) -> list[bytes]:
    """The inflated contents of every object stream (`/Type /ObjStm`). One that cannot be decoded is refused:
    what it holds cannot be checked."""
    inflated: list[bytes] = []
    budget = MAX_PDF_INFLATED_BYTES
    for match in _PDF_STREAM.finditer(raw):
        head = raw[max(0, match.start() - _PDF_DICT_LOOKBACK) : match.start()]
        dictionary = head[head.rfind(b"obj") + 3 :] if b"obj" in head else head
        names = [name for name, _ in _pdf_names(dictionary)]
        if b"ObjStm" not in names:
            continue
        end = raw.find(b"endstream", match.end())
        body = raw[match.end() : end if end >= 0 else len(raw)]
        filters = [n for n in names if n.endswith(b"Decode") or n in (b"Fl", b"AHx", b"A85", b"LZW", b"RL")]
        if not filters:
            content = body
        elif filters in ([b"FlateDecode"], [b"Fl"]):
            decoder = zlib.decompressobj()
            try:
                content = decoder.decompress(body, budget + 1)
            except zlib.error:
                raise RejectedPdf(UNCHECKABLE_PDF) from None
        else:
            raise RejectedPdf(UNCHECKABLE_PDF)
        budget -= len(content)
        if budget < 0:
            raise RejectedPdf(UNCHECKABLE_PDF)
        inflated.append(content)
    return inflated


ACTIVE_PDF = "PDFs with scripts, automatic actions, unsafe links, forms or embedded files are not accepted."
UNCHECKABLE_PDF = "This PDF stores its content in a way that cannot be checked; save or print it again as a PDF."


def check_pdf(raw: bytes) -> CheckedPdf:
    """Accepts a PDF by its magic bytes and refuses active content: blocked names (escapes decoded) anywhere in
    the file and inside its object streams, and any /OpenAction that is not a plain destination. A heuristic
    kept as defence in depth: names inside other compressed streams (page content) are not read, and the bytes
    are stored as uploaded, never parsed or rendered server-side.

    The file is served inline (so browsers show it in their PDF viewer) with `X-Content-Type-Options: nosniff`
    and `Content-Security-Policy: sandbox` (app/routes/program_files.py): the viewer runs in a sandboxed, opaque
    origin without scripts, verified to display schedules in Chrome. That, not this check, is what keeps a PDF
    from acting on the site; downloading as an attachment was not needed."""
    if not raw.startswith(PDF_MAGIC):
        raise RejectedPdf("The file is not a PDF.")
    _refuse_active_names(raw)
    for content in _object_streams(raw):
        _refuse_active_names(content)
    pages = len(_PDF_PAGE.findall(raw))
    return CheckedPdf(sha256=hashlib.sha256(raw).hexdigest(), page_count=pages or None)


def storage_key_for(event_id: uuid.UUID, asset_id: uuid.UUID, extension: str) -> str:
    return f"{event_id}/{asset_id}.{extension}"


def resolve_storage_path(media_root: Path, storage_key: str) -> Path:
    """Absolute path of a stored file; refuses anything that would leave the media root."""
    root = media_root.resolve()
    path = (root / storage_key).resolve()
    if root not in path.parents:
        raise ValueError("Storage key escapes the media root")
    return path


def write_file(media_root: Path, storage_key: str, data: bytes) -> None:
    """Atomic write: readers see the whole file or no file."""
    path = resolve_storage_path(media_root, storage_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".upload-")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def delete_file(media_root: Path, storage_key: str) -> None:
    resolve_storage_path(media_root, storage_key).unlink(missing_ok=True)
