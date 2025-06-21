import logging
import os
import re
from app.weaviate_client import setup_weaviate_schema
from helper_functions.weaviate_test import check_file_exists
from utils.unstructured import extract_from_file
from helper_functions.upload_weaviate import upload_to_weaviate


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

        file_type = data.get("fileType").split('/')[-1]

        if file_type not in ["png", "jpg", "jpeg" , "mp3", "mp4", "wav"]:
            text_extracted = extract_from_file(file_path)
            if(not text_extracted):
                return {
                    "message": "No text extracted from the file",
                    "created": False
                }
            res = upload_to_weaviate(text_extracted, data)
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

