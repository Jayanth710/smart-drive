import logging

from .docling import extract_content
from smartdrive_core.llm import LLM_doc_summarize, get_embedding
from smartdrive_core.metrics import stage_timer
from .weaviate_utils import save_doc, save_doc_private

logger = logging.getLogger(__name__)


def process_document(file_path: str, data: dict) -> dict:
    """Extract -> summarise -> embed summary -> save summary row (and raw text).

    NOTE: we DO NOT chunk or per-chunk embed here. Chunking + chunk embeddings
    are computed lazily by the backend the first time a user chats with the
    file. This trades a one-time first-chat latency for ~95% storage and
    compute savings on the majority of files that are never chatted with.

    When data["isPrivate"] is True, all LLM calls are skipped — we write only a
    filename stub so the file is still findable by name but its contents never
    touch any LLM API.
    """
    filename = data.get("fileName", "")
    file_id = str(data.get("_id", ""))

    if data.get("isPrivate"):
        logger.info(f"Private file {filename} (id={file_id}): skipping LLM extraction; indexing filename only")
        save_doc_private(data)
        return {
            "message": f"Saved {filename} as private (content not indexed)",
            "created": True,
        }

    # ---- extract ----
    with stage_timer("extract", file_id=file_id):
        res = extract_content(file_path)
    if not res or not res.get("created"):
        return {"message": f"Extraction failed for {filename}", "created": False, "error_kind": "extraction_failed"}

    markdown = (res.get("markdown") or "").strip()
    if not markdown:
        return {"message": f"No text extracted for {filename}", "created": False, "error_kind": "no_content"}

    # ---- summarise ----
    with stage_timer("summarize", file_id=file_id, chars=len(markdown)):
        summary, index_json = LLM_doc_summarize(markdown)
    if not summary:
        return {"message": "Failed to generate summary", "created": False, "error_kind": "llm_failed"}

    # ---- embed summary only (file-level vector for cross-file search) ----
    summary_embed_text = f"{summary}\n\nKeywords: {index_json}"
    with stage_timer("embed_summary", file_id=file_id):
        summary_vector = get_embedding(summary_embed_text)
    if not summary_vector:
        return {"message": "Failed to embed summary", "created": False, "error_kind": "embedding_failed"}

    # ---- save summary row with raw_text (used later for lazy chat prep) ----
    with stage_timer("save_summary", file_id=file_id):
        save_doc(
            data,
            summary,
            index_json,
            summary_vector,
            raw_text=markdown,
            chunk_count=0,  # chunks are built lazily; this is just a placeholder
        )

    return {
        "message": f"Saved {filename} (chat will be prepared on first message)",
        "created": True,
    }
