import logging
import os
import re

from smartdrive_core.weaviate_client import check_file_exists
from .image_pipeline import process_image
from .document_extractor import process_document

logger = logging.getLogger(__name__)

DOC_COLLECTION = os.getenv("DOC_COLLECTION", "SmartDriveDocuments")
IMG_COLLECTION = os.getenv("IMG_COLLECTION", "SmartDriveImages")

def route_and_process(file_path: str, data: dict):

    try:
        # ---- validate inputs ----
        data["fileName"] = re.sub(r"\s+", "_", data.get("fileName", "")).strip()
        filename = data["fileName"]
        if not filename:
            return {"message": "No file name provided", "created": False}

        file_id = data.get("_id")
        user_id = data.get("userId")
        if not file_id or not user_id:
            return {"message": "Missing required fields (_id/userId)", "created": False}

        mime = (data.get("fileType") or "").lower()

        # ---- skip media in doc processor ----
        if mime.startswith("audio/") or mime.startswith("video/"):
            return {"message": f"Skipping media mime={mime}", "created": False}
        
        if mime.startswith("image/"):
            logger.info("checking if image exists")
            if check_file_exists(IMG_COLLECTION, str(file_id), str(user_id)):
                logger.info(f"Image file '{filename}' already exists in Weaviate. Skipping.")
                return {"message": f"Image file '{filename}' already indexed.", "created": False}
            logger.info(f"Routing image file '{filename}' to image extractor.")
            return process_image(file_path, data)

       
        logger.info("checking if document exists")
        if check_file_exists(DOC_COLLECTION, str(file_id), str(user_id)):
            logger.info(f"{filename} already exists in Weaviate. Skipping.")
            return {"message": f"{filename} already indexed.", "created": False}
        
        return process_document(file_path, data)
    
    except Exception as e:
        logger.error(f"Error in routing/processing for file '{data.get('fileName', '')}': {e}", exc_info=True)
        return {"message": f"Error processing file: {e}", "created": False}