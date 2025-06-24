import os
import cv2
import logging
import easyocr
from utils.llm import LLM_summarizer, LLM_caption_generator

logger = logging.getLogger(__name__)

try:
    reader = easyocr.Reader(['en'], gpu=False)
    logger.info("EasyOCR engine initialized successfully.")
except Exception as e:
    logger.error(f"Failed to initialize EasyOCR engine: {e}")
    reader = None

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
        # 1. Load the image in grayscale
        image = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
        if image is None:
            raise ValueError("Could not read the image file.")
        
        variance = cv2.Laplacian(image, cv2.CV_64F).var()

        if variance > threshold:
            logger.info(f"Variance ({variance:.2f}) > threshold ({threshold}). Classified as OCR.")
            return "OCR"
        else:
            logger.info(f"Variance ({variance:.2f}) <= threshold ({threshold}). Classified as CAPTION.")
            return "CAPTION"

    except Exception as e:
        logger.error(f"Local image classification failed: {e}", exc_info=True)
        return "CAPTION"


def structure_ocr_output(raw_result: list) -> str:
    """
    Takes the raw output from EasyOCR and structures the text in a more
    natural, top-to-bottom, left-to-right reading order.

    Args:
        raw_result: The list of detections directly from reader.readtext().

    Returns:
        A single string with the text structured in reading order.
    """
    structured_text = ""
    current_y = -1
    line_buffer = []

    sorted_boxes = sorted(raw_result, key=lambda res: (res[0][0][1], res[0][0][0]))

    for (bbox, text, prob) in sorted_boxes:
        top_y = bbox[0][1]

        if current_y == -1 or abs(top_y - current_y) > 10:

            if line_buffer:
                structured_text += " ".join(line_buffer) + "\n"
            line_buffer = [text]
            current_y = top_y
        else:

            line_buffer.append(text)

    if line_buffer:
        structured_text += " ".join(line_buffer)

    return structured_text

def image_ocr(image_path: str):
    """
    Performs OCR on an image file using the EasyOCR library and returns the
    extracted text as a single string.

    Args:
        image_path: The full path to the local image file (e.g., in /tmp/).

    Returns:
        A string containing all the extracted text.
    """
    if not reader:
        logger.error("OCR failed because the EasyOCR engine is not available.")
        return "[OCR failed: Engine not initialized]"
        
    try:
        logger.info(f"Performing OCR with EasyOCR on: {os.path.basename(image_path)}")

        result = reader.readtext(image_path)

        if result:
            structured_text = structure_ocr_output(result)
        else:
            structured_text = "[OCR failed: No text detected]"
        
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
        logger.error(f"An error occurred during EasyOCR processing: {e}", exc_info=True)
        return f"[OCR processing failed: {e}]"
    
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