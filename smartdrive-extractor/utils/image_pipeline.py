import logging

from smartdrive_core.llm import get_embedding
from smartdrive_core.metrics import stage_timer

from .image_utils import image_classifier, image_ocr, image_caption
from .weaviate_utils import save_image

logger = logging.getLogger(__name__)


def process_image(file_path: str, data: dict) -> dict:
    """Classify -> OCR or caption -> embed summary -> save (with raw OCR text).

    NOTE: per-chunk vectors for OCR'd text are computed lazily at first chat,
    not here. Most images won't be chatted with, so this saves storage + compute.
    """
    filename = data.get("fileName", "")
    file_id = str(data.get("_id", ""))

    try:
        with stage_timer("classify", file_id=file_id):
            classification = image_classifier(file_path)

        if classification == "OCR":
            with stage_timer("ocr+summarize", file_id=file_id):
                summary, raw_text = image_ocr(file_path)
        else:
            with stage_timer("caption", file_id=file_id):
                summary, raw_text = image_caption(file_path)

        if not summary:
            return {"message": f"Could not process image '{filename}'", "created": False, "error_kind": "llm_failed"}

        with stage_timer("embed_summary", file_id=file_id):
            summary_vector = get_embedding(summary)
        if not summary_vector:
            return {"message": "Embedding failed", "created": False, "error_kind": "embedding_failed"}

        with stage_timer("save_summary", file_id=file_id):
            res = save_image(
                data,
                summary,
                summary_vector,
                classification,
                raw_text=raw_text,
                chunk_count=0,
            )

        if not res.get("created"):
            return {"message": res.get("message", "Failed to save image"), "created": False, "error_kind": "storage_failed"}

        return {"message": f"Saved image '{filename}'", "created": True}

    except Exception as e:
        logger.error(f"Error during image processing: {e}", exc_info=True)
        return {"message": f"Error during image processing: {e}", "created": False, "error_kind": "unknown"}
