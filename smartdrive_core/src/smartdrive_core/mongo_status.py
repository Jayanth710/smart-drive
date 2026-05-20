"""Worker-side helper for updating a UserFile's extraction status in Mongo.

The backend owns the UserFile collection; workers update only the status
fields after each Pub/Sub message is processed. We keep one MongoClient per
process and bail out (with a warning) if MONGO_URI isn't configured —
extraction work still happens, just without status reporting.
"""

import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

logger = logging.getLogger(__name__)

ExtractionStatus = Literal["pending", "processing", "done", "failed"]

_client = None
_client_lock = threading.Lock()


def _get_collection():
    """Return the user_files collection, or None if Mongo isn't configured."""
    global _client
    mongo_uri = os.getenv("MONGO_URI")
    if not mongo_uri:
        logger.warning("MONGO_URI not set; extraction status updates are disabled")
        return None

    if _client is None:
        with _client_lock:
            if _client is None:
                try:
                    from pymongo import MongoClient
                except ImportError:
                    logger.error("pymongo is not installed; cannot report extraction status")
                    return None
                # serverSelectionTimeoutMS keeps a misconfigured Mongo from
                # stalling the worker for the default 30s on every message.
                _client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)

    db_name = os.getenv("MONGO_DB_NAME", "test")
    return _client[db_name]["userfiles"]


def update_status(
    file_id: str,
    status: ExtractionStatus,
    error: Optional[str] = None,
) -> bool:
    """Update extractionStatus for a UserFile. Returns True on success."""
    if not file_id:
        logger.warning("update_status called with empty file_id")
        return False

    collection = _get_collection()
    if collection is None:
        return False

    try:
        from bson import ObjectId
    except ImportError:
        logger.error("bson (from pymongo) is not installed; cannot update status")
        return False

    try:
        oid = ObjectId(file_id)
    except Exception as e:
        logger.error(f"update_status: invalid file_id {file_id!r}: {e}")
        return False

    update_doc = {
        "extractionStatus": status,
        "updatedAt": datetime.now(timezone.utc),
    }
    if error is not None:
        # Truncate long errors so we don't blow up the document.
        update_doc["extractionError"] = error[:1000]
    elif status == "done":
        # Clear stale error messages when transitioning into a healthy state.
        update_doc["extractionError"] = None

    try:
        result = collection.update_one({"_id": oid}, {"$set": update_doc})
        if result.matched_count == 0:
            logger.warning(f"update_status: no UserFile found for _id={file_id}")
            return False
        logger.info(f"Marked file {file_id} as {status}")
        return True
    except Exception as e:
        logger.error(f"Failed to update extraction status for {file_id}: {e}", exc_info=True)
        return False


def update_progress(file_id: str, stage: str, current: int = 0, total: int = 0) -> bool:
    """Report extraction progress so the UI can show "extracting page 3 of 12"
    or "transcribing audio (00:42 of 03:15)" instead of just "processing".

    The frontend polls /upload anyway — this field rides along on each poll.
    Cheap to call; safe to skip on transient Mongo errors."""
    if not file_id:
        return False
    collection = _get_collection()
    if collection is None:
        return False
    try:
        from bson import ObjectId
        oid = ObjectId(file_id)
    except Exception:
        return False
    try:
        collection.update_one(
            {"_id": oid},
            {"$set": {
                "extractionProgress": {"current": int(current), "total": int(total), "stage": stage[:80]},
                "updatedAt": datetime.now(timezone.utc),
            }},
        )
        return True
    except Exception as e:
        logger.warning(f"update_progress({file_id}, {stage}) failed: {e}")
        return False


def sweep_orphaned_files(stale_minutes: int = 10) -> int:
    """Find files stuck in `processing` for too long (worker died mid-extraction
    from OOM, timeout, deploy, etc.) and reset them to `pending` so they get
    re-queued by the next Pub/Sub redelivery.

    Without this, an OOM kills a file permanently — no retry, no cleanup.
    Call this on worker boot AND on a periodic timer.

    Returns number of files reset.
    """
    collection = _get_collection()
    if collection is None:
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=stale_minutes)
    try:
        result = collection.update_many(
            {
                "extractionStatus": "processing",
                "updatedAt": {"$lt": cutoff},
            },
            {
                "$set": {
                    "extractionStatus": "pending",
                    "extractionError": f"Auto-reset: stuck in processing for >{stale_minutes}m (likely worker OOM)",
                    "updatedAt": datetime.now(timezone.utc),
                },
            },
        )
        if result.modified_count > 0:
            logger.warning(
                f"Sweep: reset {result.modified_count} orphaned file(s) "
                f"stuck in 'processing' for >{stale_minutes}m. "
                f"They will be re-extracted on next worker poll."
            )
        return result.modified_count
    except Exception as e:
        logger.error(f"sweep_orphaned_files failed: {e}", exc_info=True)
        return 0
