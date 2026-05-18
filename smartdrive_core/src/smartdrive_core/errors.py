"""Error taxonomy for extraction failures.

A single `failed` status hides what actually went wrong. These codes let the
UI suggest different retry actions (transient vs permanent) and let dashboards
group failures by stage.
"""

from enum import Enum


class ExtractionError(str, Enum):
    DOWNLOAD_FAILED = "download_failed"           # GCS download problem
    EXTRACTION_FAILED = "extraction_failed"       # docling / ffmpeg / OCR couldn't parse
    NO_CONTENT = "no_content"                     # parsed but text/transcript was empty
    LLM_FAILED = "llm_failed"                     # Gemini summarisation error
    EMBEDDING_FAILED = "embedding_failed"         # Gemini embedding error
    STORAGE_FAILED = "storage_failed"             # Weaviate write error
    UNSUPPORTED_TYPE = "unsupported_type"         # mime not handled by this worker
    INVALID_MESSAGE = "invalid_message"           # Pub/Sub payload malformed
    UNKNOWN = "unknown"
