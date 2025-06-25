import logging
import os
from utils.weaviate_utils import check_file_exists, upload_to_weaviate
from utils.media_utils import audio_extractor, video_to_audio
from utils.llm import LLM_summarizer

logger = logging.getLogger(__name__)

def media_extractor(media_path: str, data: dict):
    
    try:
        filename = data.get("fileName", None)

        if filename is None:
            logger.error(f"No filename")
            return {
                "message": f"No filename provided",
                "created": False
            }
        
        if(check_file_exists(filename)):
            logger.info(f"Document {filename} already exists in Weaviate. Skipping saving.")
            return {
                "message": f"Document {filename} already exists in Weaviate.",
                "created": False
            }
        
        filetype = data.get("fileType" "").split('/')[0]

        if filetype in ["audio", "video"]:
            if(filetype == "video"):
                media_path = video_to_audio(media_path)
                
            text_extracted = audio_extractor(media_path)
            
            if not text_extracted:
                return {
                    "message": f"No text extracted from the audio.",
                    "created": False
                }
            summary, embedding = LLM_summarizer(text_extracted)

            if not summary or not embedding:
                logger.error(f"Failed to extract any text/caption for '{filename}'. Skipping upload.")
                return {
                    "message": f"Could not process image '{filename}'.",
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
        
        else:
            logger.info(f"File type {filetype} not supported. Skipping saving.")
            return {
                "message": f"File type {filetype} not supported.",
                "created": False
            }
        
    except Exception as e:
        logger.error("Error occurred during file extraction. {e}", exc_info=True)
        return {
            "message": f"Error occurred during file extraction. {e}",
            "created": False
        }

    finally:
        if os.path.exists(media_path):
            os.remove(media_path)
            logger.info(f"Deleted temporary file: {media_path}")
