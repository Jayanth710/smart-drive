import logging
import os
import re

from smartdrive_core.weaviate_client import check_file_exists
from smartdrive_core.mongo_status import update_status
from .image_pipeline import process_image
from .document_extractor import process_document

logger = logging.getLogger(__name__)

DOC_COLLECTION = os.getenv("DOC_COLLECTION", "SmartDriveDocuments")
IMG_COLLECTION = os.getenv("IMG_COLLECTION", "SmartDriveImages")

def route_and_process(file_path: str, data: dict):

    file_id = data.get("_id")

    try:
        # ---- validate inputs ----
        data["fileName"] = re.sub(r"\s+", "_", data.get("fileName", "")).strip()
        filename = data["fileName"]
        if not filename:
            if file_id:
                update_status(str(file_id), "failed", error="No file name provided")
            return {"message": "No file name provided", "created": False}

        user_id = data.get("userId")
        if not file_id or not user_id:
            return {"message": "Missing required fields (_id/userId)", "created": False}

        mime = (data.get("fileType") or "").lower()

        # ---- skip media in doc processor ----
        if mime.startswith("audio/") or mime.startswith("video/"):
            # The media extractor owns this message; don't change status here.
            return {"message": f"Skipping media mime={mime}", "created": False}

        update_status(str(file_id), "processing")

        if mime.startswith("image/"):
            logger.info("checking if image exists")
            if check_file_exists(IMG_COLLECTION, str(file_id), str(user_id)):
                logger.info(f"Image file '{filename}' already exists in Weaviate. Skipping.")
                update_status(str(file_id), "done")
                return {"message": f"Image file '{filename}' already indexed.", "created": False}
            logger.info(f"Routing image file '{filename}' to image extractor.")
            result = process_image(file_path, data)
        else:
            logger.info("checking if document exists")
            if check_file_exists(DOC_COLLECTION, str(file_id), str(user_id)):
                logger.info(f"{filename} already exists in Weaviate. Skipping.")
                update_status(str(file_id), "done")
                return {"message": f"{filename} already indexed.", "created": False}
            result = process_document(file_path, data)

        if result.get("created"):
            update_status(str(file_id), "done")
        else:
            update_status(str(file_id), "failed", error=result.get("message", "Extraction failed"))
        return result

    except Exception as e:
        logger.error(f"Error in routing/processing for file '{data.get('fileName', '')}': {e}", exc_info=True)
        if file_id:
            update_status(str(file_id), "failed", error=str(e))
        return {"message": f"Error processing file: {e}", "created": False}