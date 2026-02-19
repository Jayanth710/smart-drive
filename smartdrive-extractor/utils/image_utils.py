import os
import cv2
import logging
from PIL import Image
import numpy as np
from smartdrive_core.llm import LLM_image_summarizer, LLM_caption_generator
from .document_extractor import extract_content  # your docling-based extractor

logger = logging.getLogger(__name__)

def image_classifier(image_path: str, threshold: float = 850.0) -> str:
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

        extracted_content = extract_content(image_path)
        data_extracted = extracted_content.get("markdown", "")

        if not data_extracted:
            logger.warning(f"EasyOCR did not extract any text from {image_path}.")
            return {
                "message": f"No text extracted from the image.",
                "created": False
            }
        
        logger.info("EasyOCR extraction completed successfully.")
        summary, embeddings = LLM_image_summarizer(data_extracted)

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