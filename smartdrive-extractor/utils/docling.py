import logging
import os
import re

from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, EasyOcrOptions, TableStructureOptions
from .text_extractor import extract_plain_text

logger = logging.getLogger(__name__)

_converter = None


def get_converter():
    global _converter
    if _converter is None:
        logger.info("Initializing Docling DocumentConverter (EasyOCR forced)...")
        opts = PdfPipelineOptions()
        opts.do_ocr = True
        opts.ocr_options = EasyOcrOptions(lang=["en"], use_gpu=False)
        opts.do_table_structure = True
        opts.table_structure_options = TableStructureOptions(do_cell_matching=True)
        _converter = DocumentConverter(
            format_options={
                InputFormat.IMAGE: ImageFormatOption(pipeline_options=opts),
                InputFormat.PDF: PdfFormatOption(pipeline_options=opts),
            }
        )
    return _converter


# ============================================================================
# E2 — Early checks: encrypted/protected PDFs and obvious junk
# ============================================================================

def _is_pdf(file_path: str) -> bool:
    return os.path.splitext(file_path)[1].lower() == ".pdf"


def _pdf_is_encrypted(file_path: str) -> bool:
    """Read first 4KB of a PDF and check for /Encrypt marker. Costs ~1ms vs
    60s + OOM risk of letting docling try to parse an encrypted PDF."""
    try:
        with open(file_path, "rb") as f:
            head = f.read(4096)
        # PDF spec: /Encrypt entry in trailer or document catalog.
        # Heuristic: if /Encrypt appears in the first 4KB header, it's encrypted.
        return b"/Encrypt" in head
    except Exception as e:
        logger.warning(f"_pdf_is_encrypted check failed: {e}")
        return False


def _pdf_is_valid(file_path: str) -> bool:
    """Sanity check: file starts with %PDF magic bytes."""
    try:
        with open(file_path, "rb") as f:
            return f.read(5) == b"%PDF-"
    except Exception:
        return False


# ============================================================================
# E3 — Quality check on extracted text
# ============================================================================

_NON_ALNUM_RE = re.compile(r"[^a-zA-Z0-9\s]")


def _looks_like_garbage(text: str) -> tuple[bool, str]:
    """Return (is_garbage, reason). Catches OCR garbage and binary echoes
    before we waste an LLM call summarizing them."""
    if not text:
        return True, "empty"
    if len(text) < 50:
        return True, f"too_short ({len(text)} chars)"

    # Non-alphanumeric ratio: garbage OCR produces lots of symbols.
    sample = text[:5000]
    non_alnum = len(_NON_ALNUM_RE.findall(sample))
    ratio = non_alnum / max(1, len(sample))
    if ratio > 0.4:
        return True, f"high_symbol_ratio ({ratio:.2f})"

    # Repetitiveness: if 80% of the text is one repeated chunk,
    # it's probably a header/footer that wasn't stripped, or OCR loop.
    words = text.split()
    if len(words) >= 30:
        unique_ratio = len(set(w.lower() for w in words[:200])) / min(200, len(words))
        if unique_ratio < 0.15:
            return True, f"low_unique_ratio ({unique_ratio:.2f})"

    return False, ""


# ============================================================================
# E3 fallback: PyPDF for text-extraction when docling fails
# ============================================================================

def _pypdf_fallback(file_path: str) -> dict:
    """Last-resort PDF text extraction. No layout awareness, no OCR, but
    very fast and never OOMs. For text-PDF cases where docling crashes,
    this gets us *something* indexable.
    """
    try:
        from pypdf import PdfReader  # pypdf >= 4.0 ships with the project's deps
    except ImportError:
        try:
            from PyPDF2 import PdfReader  # type: ignore
        except ImportError:
            logger.warning("pypdf/PyPDF2 not installed — fallback unavailable")
            return {"created": False, "markdown": "", "metadata": None}

    try:
        reader = PdfReader(file_path)
        if reader.is_encrypted:
            return {"created": False, "markdown": "", "metadata": {"error": "encrypted"}}
        pages = []
        for i, page in enumerate(reader.pages):
            try:
                pages.append((page.extract_text() or "").strip())
            except Exception as e:
                logger.warning(f"pypdf page {i} extract failed: {e}")
        text = "\n\n".join(p for p in pages if p).strip()
        if not text:
            return {"created": False, "markdown": "", "metadata": None}
        logger.info(f"pypdf fallback extracted {len(text)} chars from {len(pages)} pages")
        return {
            "created": True,
            "markdown": text,
            "metadata": {"fallback": "pypdf", "page_count": len(pages)},
        }
    except Exception as e:
        logger.warning(f"pypdf fallback failed: {e}")
        return {"created": False, "markdown": "", "metadata": None}


# ============================================================================
# Main entry — docling primary with layered guards and fallbacks
# ============================================================================

def extract_content(file_path: str) -> dict:
    """Extraction with guards:
      1. If PDF: validate magic bytes + encryption check (fail fast)
      2. Try docling (primary)
      3. If docling fails OR returns garbage: try pypdf fallback for PDFs
      4. If still nothing: plain-text fallback for known extensions
    """
    # E2 — Early PDF validation
    if _is_pdf(file_path):
        if not _pdf_is_valid(file_path):
            logger.warning(f"PDF magic bytes missing for {file_path} — not a valid PDF")
            return {"created": False, "markdown": "", "metadata": {"error": "invalid_pdf"}}
        if _pdf_is_encrypted(file_path):
            logger.warning(f"PDF is encrypted, skipping: {file_path}")
            return {
                "created": False,
                "markdown": "",
                "metadata": {"error": "encrypted"},
                "error_kind": "encrypted_pdf",
            }

    # Primary: docling
    docling_result = _run_docling(file_path)

    # E3 — Quality check
    if docling_result.get("created"):
        text = docling_result.get("markdown", "")
        is_garbage, reason = _looks_like_garbage(text)
        if is_garbage:
            logger.warning(f"Docling output failed quality check ({reason}) — trying fallback")
            docling_result = {"created": False, "markdown": "", "metadata": {"quality_fail": reason}}

    if docling_result.get("created"):
        return docling_result

    # Fallback chain
    if _is_pdf(file_path):
        pypdf_result = _pypdf_fallback(file_path)
        if pypdf_result.get("created"):
            # Quality check the fallback too
            text = pypdf_result.get("markdown", "")
            is_garbage, reason = _looks_like_garbage(text)
            if not is_garbage:
                return pypdf_result
            logger.warning(f"pypdf fallback also failed quality ({reason})")

    # Last resort: plain-text for known extensions
    return extract_plain_text(file_path)


def _is_image_only_pdf(file_path: str) -> bool:
    """E7 — heuristic detection of image-only (scanned) PDFs.
    Image-only PDFs have low/no extractable text but high page count or
    large file size. These are OCR-heavy and need more memory + time.
    Costs ~50ms via pypdf vs minutes via docling-then-fail."""
    try:
        from pypdf import PdfReader
    except ImportError:
        return False
    try:
        reader = PdfReader(file_path)
        if not reader.pages:
            return False
        # Sample first 3 pages — if they have <50 chars of extractable text
        # but the PDF is >100KB, it's likely image-only (scanned).
        sample_text = ""
        for page in reader.pages[:3]:
            try:
                sample_text += (page.extract_text() or "")
            except Exception:
                pass
        file_size = os.path.getsize(file_path)
        if len(sample_text.strip()) < 50 and file_size > 100_000:
            return True
        return False
    except Exception:
        return False


def _run_docling(file_path: str) -> dict:
    try:
        # E7 — log image-only route for memory observability.
        if _is_pdf(file_path) and _is_image_only_pdf(file_path):
            file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
            logger.info(
                f"📷 Image-only PDF detected ({file_size_mb:.1f}MB) — "
                f"OCR-heavy path; expect higher memory + slower extraction"
            )

        result = get_converter().convert(file_path)
        doc = result.document
        markdown = (doc.export_to_markdown() or "").strip()
        text = (doc.export_to_text() or "").strip()
        metadata = doc.export_to_dict()

        # E6 — per-page observability. Pulls page count from metadata if
        # present so we can compare extracted_chars / page_count and spot
        # half-extracted PDFs.
        page_count = 0
        try:
            page_count = len((metadata or {}).get("pages", []) or [])
        except Exception:
            pass

        if markdown:
            logger.info(
                f"✅ Docling extracted {len(markdown)} chars across {page_count or '?'} pages "
                f"— preview: {markdown[:50]}..."
            )
            if page_count > 0:
                chars_per_page = len(markdown) / page_count
                if chars_per_page < 50:
                    logger.warning(
                        f"⚠️ Low chars/page ratio ({chars_per_page:.0f}) — "
                        f"PDF may be partially extracted (image-only pages, OCR misfires)"
                    )
        elif text:
            logger.info(f"✅ Docling extracted {len(text)} chars (text-only fallback)")
            markdown = text
        else:
            logger.warning(f"⚠️ Docling returned empty content (page_count={page_count})")
            return {"created": False, "markdown": "", "metadata": metadata}

        return {"created": True, "markdown": markdown, "metadata": metadata}

    except Exception as e:
        msg = str(e)
        if "File format not allowed" in msg or "does not match any" in msg:
            logger.warning(f"Docling unsupported format: {msg}")
        else:
            logger.exception(f"❌ Docling extraction crashed: {e}")
        return {"created": False, "markdown": "", "metadata": None}
