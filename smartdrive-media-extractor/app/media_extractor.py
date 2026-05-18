import logging
import os
import re
from smartdrive_core.weaviate_client import check_file_exists
from utils.media_utils import audio_extractor, video_to_audio
from smartdrive_core.llm import LLM_media_summarizer
from utils.weaviate_utils import save_media

logger = logging.getLogger(__name__)

MEDIA_COLLECTION = "SmartDriveMedia"

def media_extractor(media_path: str, data: dict):
    
    try:
        data["fileName"] = re.sub(r"\s+", "_", data.get("fileName", "")).strip()
        filename = data["fileName"]
        if not filename:
            return {"message": "No file name provided", "created": False}

        file_id = data.get("_id")
        user_id = data.get("userId")
        if not file_id or not user_id:
            return {"message": "Missing required fields (_id/userId)", "created": False}

        mime = (data.get("fileType") or "").lower()
        
        if(check_file_exists(MEDIA_COLLECTION, file_id, user_id)):
            logger.info(f"Document {filename} already exists in Weaviate. Skipping saving.")
            return {
                "message": f"Document {filename} already exists in Weaviate.",
                "created": False
            }
        
        filetype = mime.split('/')[0]

        if filetype in ["audio", "video"]:
            if(filetype == "video"):
                media_path = video_to_audio(media_path)
                
            text_extracted = audio_extractor(media_path)
            
            if not text_extracted:
                return {
                    "message": f"No text extracted from the audio.",
                    "created": False
                }
            # ---- summarize + embed ----
            logger.info(f"Summarizing + embedding for {filename}")
            summary, embedding = LLM_media_summarizer(text_extracted)
            if not summary or not embedding:
                return {"message": "Failed to generate summary/embedding", "created": False}

            # ---- save ----
            upload_result = save_media(data, summary, embedding)
            return {"message": upload_result.get("message", "Saved"), "created": True}
        
        else:
            logger.info(f"File type {filetype} not supported. Skipping saving.")
            return {
                "message": f"File type {filetype} not supported.",
                "created": False
            }
        
    except Exception as e:
        logger.error(f"Error occurred during file extraction: {e}", exc_info=True)
        return {
            "message": f"Error occurred during file extraction: {e}",
            "created": False
        }
