import os
import cv2
import logging
import easyocr
from PIL import Image
import numpy as np
from utils.llm import LLM_summarizer, LLM_caption_generator

logger = logging.getLogger(__name__)

# try:
#     reader = easyocr.Reader(['en'], gpu=False)
#     logger.info("EasyOCR engine initialized successfully.")
# except Exception as e:
#     logger.error(f"Failed to initialize EasyOCR engine: {e}")
#     reader = None

_reader = None

def get_reader():
    global _reader
    if _reader is None:
        logger.info("Initializing EasyOCR reader...")
        _reader = easyocr.Reader(['en'], gpu=False)
        logger.info("EasyOCR engine initialized.")
    return _reader

def image_classifier(image_path: str, threshold: float = 450.0) -> str:
    """
    Analyzes an image's "busyness" using Laplacian variance to decide if it's
    better suited for OCR or for captioning. This is a fast, local method.

    Args:
        image_path: The local path to the image file (e.g., in /tmp/).
        threshold: The variance threshold to distinguish between text and photos.
                   This value may need tuning based on your documents.

    Returns:
        A string, either 'OCR' or 'CAPTION'.
    """
    try:
        with Image.open(image_path) as img:
            gray_image_for_cv2 = cv2.cvtColor(np.array(img.convert('RGB')), cv2.COLOR_RGB2GRAY)

        variance = cv2.Laplacian(gray_image_for_cv2, cv2.CV_64F).var()
        logger.info(f"Image Laplacian variance: {variance:.2f}")
        return "OCR" if variance > threshold else "CAPTION"
    except Exception as e:
        logger.error(f"Local image classification failed: {e}")
        return "CAPTION"

def image_ocr(image_path: str):
    """
    Performs OCR on an image file using the EasyOCR library and returns the
    extracted text as a single string.

    Args:
        image_path: The full path to the local image file (e.g., in /tmp/).

    Returns:
        A string containing all the extracted text.
    """
    try:
        reader = get_reader()
        result = reader.readtext(image_path)
    except Exception as e:
        logger.error(f"Error during EasyOCR processing: {e}", exc_info=True)
        return "[OCR failed]"

    # result = reader.readtext(image_path)
    try:

        text_lines = [line[1] for line in result]
        structured_text = "\n".join(text_lines)

        logger.info("EasyOCR extraction completed successfully.")
        summary, embeddings = LLM_summarizer(structured_text)

        if not summary or not embeddings:
            logger.error("LLM failed to summarize the extracted text.")
            return {
                "message": "LLM failed to summarize the extracted text.",
                "created": False
            }

        return summary, embeddings
    
    except Exception as e:
        logger.error(f"Error during EasyOCR processing: {e}")
        return ""
    
def image_caption(image_path: str):
    """
    Generates a caption for an image file using the LLM Captioning and returns
    the caption as a string."""

    try:
        summary, embeddings = LLM_caption_generator(image_path)

        if not summary or not embeddings:
            logger.error("LLM failed to summarize the extracted text.")
            return {
                "message": "LLM failed to summarize the extracted text.",
                "created": False
            }
        
        return summary, embeddings
    except Exception as e:
        logger.error(f"An error occurred during LLM Captioning: {e}", exc_info=True)
        return f"[Captioning failed: {e}]"