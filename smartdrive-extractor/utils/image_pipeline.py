import logging

from .image_utils import image_classifier, image_ocr, image_caption
from .weaviate_utils import save_image

logger = logging.getLogger(__name__)

def process_image(file_path: str, data: dict) -> dict:
    """
    Assumes:
      - router already validated _id/userId/fileName and normalized fileName
      - router already performed idempotency check for IMG_COLLECTION
      - router decides this is an image mime
    """
    filename = data.get("fileName", "")

    try:
        classification_type = image_classifier(file_path)
        if not classification_type:
            return {"message": f"Image classification failed for {filename}", "created": False}

        if classification_type == "OCR":
            summary, embedding = image_ocr(file_path)
        else:  # "CAPTION"
            summary, embedding = image_caption(file_path)

        if not summary or not embedding:
            return {"message": f"Could not process image '{filename}'", "created": False}

        res = save_image(data, summary, embedding, classification_type)
        if not res.get("created"):
            return {"message": res.get("message", "Failed to save image"), "created": False}

        return {"message": res.get("message", "Saved image"), "created": True}

    except Exception as e:
        logger.error(f"Error occurred during image processing: {e}", exc_info=True)
        return {"message": f"Error occurred during image processing: {e}", "created": False}