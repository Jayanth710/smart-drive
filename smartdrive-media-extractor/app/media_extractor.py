import logging
import re
from smartdrive_core.weaviate_client import check_file_exists
from smartdrive_core.mongo_status import update_status
from utils.media_utils import audio_extractor, video_to_audio
from smartdrive_core.llm import LLM_media_summarizer
from utils.weaviate_utils import save_media

logger = logging.getLogger(__name__)

MEDIA_COLLECTION = "SmartDriveMedia"


def _finish(file_id, status, message, created, error=None):
    if file_id:
        update_status(str(file_id), status, error=error)
    return {"message": message, "created": created}


def media_extractor(media_path: str, data: dict):
    file_id = data.get("_id")

    try:
        data["fileName"] = re.sub(r"\s+", "_", data.get("fileName", "")).strip()
        filename = data["fileName"]
        if not filename:
            return _finish(file_id, "failed", "No file name provided", False, error="No file name provided")

        user_id = data.get("userId")
        if not file_id or not user_id:
            return {"message": "Missing required fields (_id/userId)", "created": False}

        mime = (data.get("fileType") or "").lower()
        filetype = mime.split("/")[0]

        if filetype not in ("audio", "video"):
            # Not this worker's job; the doc extractor owns this message.
            return {"message": f"Skipping non-media mime={mime}", "created": False}

        update_status(str(file_id), "processing")

        if check_file_exists(MEDIA_COLLECTION, file_id, user_id):
            logger.info(f"Document {filename} already exists in Weaviate. Skipping saving.")
            return _finish(file_id, "done", f"Document {filename} already exists in Weaviate.", False)

        if filetype == "video":
            media_path = video_to_audio(media_path)

        text_extracted = audio_extractor(media_path)
        if not text_extracted:
            return _finish(file_id, "failed", "No text extracted from the audio.", False,
                           error="No text extracted from the audio.")

        logger.info(f"Summarizing + embedding for {filename}")
        summary, embedding = LLM_media_summarizer(text_extracted)
        if not summary or not embedding:
            return _finish(file_id, "failed", "Failed to generate summary/embedding", False,
                           error="Failed to generate summary/embedding")

        upload_result = save_media(data, summary, embedding)
        return _finish(file_id, "done", upload_result.get("message", "Saved"), True)

    except Exception as e:
        logger.error(f"Error occurred during file extraction: {e}", exc_info=True)
        return _finish(file_id, "failed", f"Error occurred during file extraction: {e}", False, error=str(e))
