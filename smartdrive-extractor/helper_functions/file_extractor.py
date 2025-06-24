import logging
import os
import re
from helper_functions.weaviate_utils import setup_weaviate_schema
from helper_functions.weaviate_utils import check_file_exists, upload_to_weaviate
from utils.unstructured import extract_from_file
from helper_functions.image_utils import image_classifier, image_ocr
from helper_functions.llm import LLM_summarizer, LLM_caption_generator


logger = logging.getLogger(__name__)

def file_extractor(file_path: str, data: dict):
    """Redirect the data from the file based on the application typeand writes it to a weaviate."""

    try:
    
        setup_weaviate_schema()

        data["fileName"] = re.sub(r'\s+', '_', data["fileName"])
        filename = data.get("fileName", "")

        if(not filename):
            return {
                "message": "No file name provided",
                "created": False
            }

        if(check_file_exists(filename)):
                logger.info(f"Document {filename} already exists in Weaviate. Skipping saving.")
                return {
                    "message": f"Document {filename} already exists in Weaviate.",
                    "created": False
                }

        file_type = data.get("fileType").split('/')[0]

        if file_type in ["application", "text"]:
            text_extracted = extract_from_file(file_path)
            if(not text_extracted):
                return {
                    "message": "No text extracted from the file",
                    "created": False
                }
            summary, embedding = LLM_summarizer(text_extracted, "application")
            if(not summary or not embedding):
                return {
                    "message": "No summary embedding generated",
                    "created": False
                }
            res = upload_to_weaviate(data, summary, embedding)
            if(not res.get("created")):
                return {
                    "message": res.get("message"),
                    "created": False
                }
            
            return {
                "message": res.get("message"),
                "created": True,
            }
        elif file_type in ["image"]:
            classification_type = image_classifier(file_path)
            if(not classification_type):
                return {
                    "message": "No text extracted from the file",
                    "created": False
                }
            if classification_type == "OCR":
                res_data = image_ocr(file_path)
                summary, embedding = LLM_summarizer(res_data, "image-ocr")
            elif classification_type == "CAPTION":
                summary, embedding = LLM_caption_generator(file_path)
            
            if(not summary or not embedding):
                return {
                    "message": "No summary embedding generated",
                    "created": False
                }
            
            if summary:
                res = upload_to_weaviate(data, summary, embedding)
                if(not res.get("created")):
                    return {
                        "message": res.get("message"),
                        "created": False
                    }
                return {
                    "message": res.get("message"),
                    "created": True,
                }
        else:
            logger.info(f"File type {file_type} not supported. Skipping saving.")
            return {
                "message": f"File type {file_type} not supported.",
                "created": False
            }

    except Exception as e:
        logger.error("Error occurred during file extraction. {e}", exc_info=True)
        return {
            "message": f"Error occurred during file extraction. {e}",
            "created": False
        }

    finally:
        if os.path.exists(file_path):
            os.remove(file_path)
            logger.info(f"Deleted temporary file: {file_path}")

    # match file_type:
    #     case "pdf":
    #         logger.info("Extracting PDF data...")
    #         res = extract_data_from_pdf(output_path, data)
    #         if(not res.get("created")):
    #             return {
    #                 "message": res.get("message"),
    #                 "created": False
    #             }
    #         else:
    #             return {
    #                 "message": res.get("message"),
    #                 "created": True,
    #             }

