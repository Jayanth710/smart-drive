"""Worker-side helper for updating a UserFile's extraction status in Mongo.

The backend owns the UserFile collection; workers update only the status
fields after each Pub/Sub message is processed. We keep one MongoClient per
process and bail out (with a warning) if MONGO_URI isn't configured —
extraction work still happens, just without status reporting.
"""

import logging
import os
import threading
from datetime import datetime, timezone
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
