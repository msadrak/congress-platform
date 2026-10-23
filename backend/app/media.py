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
# Active content a schedule never needs. A heuristic (names inside compressed object streams are not seen),
# kept as defence in depth: the file is also served sandboxed and never executed by this server.
_PDF_ACTIVE_CONTENT = re.compile(rb"/(?:JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|XFA)(?![A-Za-z0-9])")
_PDF_PAGE = re.compile(rb"/Type\s*/Page(?![A-Za-z0-9])")


class RejectedPdf(ValueError):
    """The upload is not an acceptable PDF. The message is safe to show to the organizer."""


@dataclass(frozen=True)
class CheckedPdf:
    sha256: str
    # Counted from uncompressed page objects; None when the file keeps them in object streams.
    page_count: int | None


def check_pdf(raw: bytes) -> CheckedPdf:
    """Accepts a PDF by its magic bytes and refuses active content. The bytes are stored as uploaded (they are
    never parsed or rendered server-side), under a generated name, and served sandboxed."""
    if not raw.startswith(PDF_MAGIC):
        raise RejectedPdf("The file is not a PDF.")
    if _PDF_ACTIVE_CONTENT.search(raw):
        raise RejectedPdf("PDFs with scripts, launch actions or embedded files are not accepted.")
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
