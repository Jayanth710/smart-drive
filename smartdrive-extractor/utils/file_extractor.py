import logging
import os
import re
from utils.weaviate_utils import setup_weaviate_schema
from utils.weaviate_utils import check_file_exists, upload_to_weaviate
from utils.unstructured import extract_from_file
from utils.llm import LLM_summarizer


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
        
        file_id = data.get("_id", "")
        user_id = data.get("userId", "")

        if not file_id or not user_id:
            return {
                "message": "Missing required fields in the data",
                "created": False
            }

        if(check_file_exists(file_id, user_id)):
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
            user_summary, index_json, embedding = LLM_summarizer(text_extracted)
            if(not user_summary or not embedding):
                return {
                    "message": "No summary embedding generated",
                    "created": False
                }
            res = upload_to_weaviate(data, user_summary, index_json, embedding)
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

