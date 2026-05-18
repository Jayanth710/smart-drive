import logging
import re
from smartdrive_core.weaviate_client import check_file_exists
from smartdrive_core.mongo_status import update_status
from smartdrive_core.llm import LLM_media_summarizer, get_embedding
from smartdrive_core.metrics import stage_timer
from utils.media_utils import audio_extractor, video_to_audio
from utils.weaviate_utils import save_media, save_media_private, MEDIA_COLLECTION

logger = logging.getLogger(__name__)


def _finish(file_id, status, message, created, error=None, error_kind=None):
    if file_id:
        update_status(str(file_id), status, error=error)
    out = {"message": message, "created": created}
    if error_kind:
        out["error_kind"] = error_kind
    return out


def media_extractor(media_path: str, data: dict):
    """Extract audio/video, summarise, embed summary, save row + raw transcript.

    NOTE: per-chunk transcript embeddings are NOT computed here. The backend's
    lazy chat-prep pipeline does that on the first chat with the file.
    """
    file_id = data.get("_id")

    try:
        data["fileName"] = re.sub(r"\s+", "_", data.get("fileName", "")).strip()
        filename = data["fileName"]
        if not filename:
            return _finish(file_id, "failed", "No file name provided", False,
                           error="No file name provided", error_kind="invalid_message")

        user_id = data.get("userId")
        if not file_id or not user_id:
            return {"message": "Missing required fields (_id/userId)", "created": False, "error_kind": "invalid_message"}

        mime = (data.get("fileType") or "").lower()
        filetype = mime.split("/")[0]

        if filetype not in ("audio", "video"):
            return {"message": f"Skipping non-media mime={mime}", "created": False, "error_kind": "unsupported_type"}

        update_status(str(file_id), "processing")

        if data.get("isPrivate"):
            logger.info(f"Private media {filename} (id={file_id}): skipping transcription/LLM; indexing filename only")
            save_media_private(data)
            return _finish(file_id, "done", f"Saved {filename} as private (audio not transcribed)", True)

        if check_file_exists(MEDIA_COLLECTION, file_id, user_id):
            logger.info(f"{filename} already exists in Weaviate. Skipping.")
            return _finish(file_id, "done", f"{filename} already indexed.", False)

        if filetype == "video":
            with stage_timer("video_to_audio", file_id=str(file_id)):
                media_path = video_to_audio(media_path)
                if not media_path:
                    return _finish(file_id, "failed", "Failed to extract audio from video", False,
                                   error="ffmpeg failed", error_kind="extraction_failed")

        with stage_timer("transcribe", file_id=str(file_id)):
            transcript = audio_extractor(media_path)
        if not transcript:
            return _finish(file_id, "failed", "No text extracted from the audio.", False,
                           error="Empty transcript", error_kind="no_content")

        with stage_timer("summarize", file_id=str(file_id), chars=len(transcript)):
            summary, _ = LLM_media_summarizer(transcript)
        if not summary:
            return _finish(file_id, "failed", "Failed to generate summary", False,
                           error="LLM returned empty summary", error_kind="llm_failed")

        with stage_timer("embed_summary", file_id=str(file_id)):
            summary_vector = get_embedding(summary)
        if not summary_vector:
            return _finish(file_id, "failed", "Failed to embed summary", False,
                           error="Embedding API returned None", error_kind="embedding_failed")

        # Save summary row + full raw transcript for lazy chat-prep later.
        with stage_timer("save_summary", file_id=str(file_id)):
            save_media(data, summary, summary_vector, raw_text=transcript, chunk_count=0)

        return _finish(file_id, "done", f"Saved {filename} (chat will be prepared on first message)", True)

    except Exception as e:
        logger.error(f"Error during media extraction: {e}", exc_info=True)
        return _finish(file_id, "failed", f"Error during media extraction: {e}", False,
                       error=str(e), error_kind="unknown")
