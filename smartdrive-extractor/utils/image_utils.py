"""Image processing utilities.

Returns are intentionally consistent: a tuple of (summary_str_or_None, raw_text_str).
Callers compute embeddings themselves so we don't pay for them on failure paths.
"""

import logging
import cv2
import numpy as np
from PIL import Image

from smartdrive_core.llm import LLM_image_summarizer, LLM_caption_generator
from .docling import extract_content

logger = logging.getLogger(__name__)


def image_classifier(image_path: str, threshold: float = 850.0) -> str:
    """Decide between OCR and captioning based on image "busyness".

    Laplacian variance: documents/text have high variance (sharp edges);
    photos have low variance. Tuned by `threshold`. Falls back to CAPTION
    on any error so we never lose the file entirely.
    """
    try:
        with Image.open(image_path) as img:
            gray = cv2.cvtColor(np.array(img.convert("RGB")), cv2.COLOR_RGB2GRAY)
        variance = cv2.Laplacian(gray, cv2.CV_64F).var()
        logger.info(f"Image Laplacian variance: {variance:.2f}")
        return "OCR" if variance > threshold else "CAPTION"
    except Exception as e:
        logger.error(f"Local image classification failed: {e}")
        return "CAPTION"


def image_ocr(image_path: str) -> tuple[str | None, str]:
    """Run EasyOCR (via docling), then summarise the extracted text.

    Returns: (summary_or_None, raw_ocr_text)
    """
    try:
        extracted = extract_content(image_path)
        raw_text = (extracted or {}).get("markdown", "") or ""
        if not raw_text:
            logger.warning(f"EasyOCR returned no text from {image_path}")
            return None, ""

        summary, _ = LLM_image_summarizer(raw_text)
        if not summary:
            logger.error("LLM_image_summarizer returned no summary.")
            return None, raw_text
        return summary, raw_text
    except Exception as e:
        logger.error(f"Error during EasyOCR processing: {e}", exc_info=True)
        return None, ""


def image_caption(image_path: str) -> tuple[str | None, str]:
    """Caption a photo with the multimodal LLM. Returns (caption_or_None, '').

    Photos don't have OCR text, so raw_text is always empty here.
    """
    try:
        summary, _ = LLM_caption_generator(image_path)
        if not summary:
            logger.error("LLM_caption_generator returned no caption.")
            return None, ""
        return summary, ""
    except Exception as e:
        logger.error(f"An error occurred during LLM captioning: {e}", exc_info=True)
        return None, ""
