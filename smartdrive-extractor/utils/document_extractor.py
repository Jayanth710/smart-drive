import logging

from .docling import extract_content 
from smartdrive_core.llm import LLM_doc_summarizer
from .weaviate_utils import save_doc

logger = logging.getLogger(__name__)


def process_document(file_path: str, data: dict) -> dict:
    """
    Extract -> summarize/embed -> save to Weaviate.
    Assumes validation + idempotency already done upstream.
    """
    filename = data.get("fileName", "")

    # ---- extract ----
    logger.info(f"📄 Extracting content for {filename}")
    res = extract_content(file_path)
    if not res or not res.get("created"):
        return {"message": f"❌ Extraction failed for {filename}", "created": False}

    markdown = (res.get("markdown") or "").strip()
    if not markdown:
        return {"message": f"⚠️ No text extracted for {filename}", "created": False}

    # ---- summarize + embed ----
    logger.info(f"Summarizing + embedding for {filename}")
    summary, index_json, embedding = LLM_doc_summarizer(markdown)
    if not summary or not embedding:
        return {"message": "Failed to generate summary/embedding", "created": False}

    # ---- save ----
    upload_result = save_doc(data, summary, index_json, embedding)
    return {"message": upload_result.get("message", "Saved"), "created": True}