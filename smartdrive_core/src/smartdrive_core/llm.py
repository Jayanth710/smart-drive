"""LLM helpers (Gemini): summarisation, captioning, embeddings.

Every external call is wrapped in `with_retry` for transient errors and is
token-aware via `tokenizer.truncate_to_tokens` / `count_tokens`. For documents
larger than ~`MAP_REDUCE_TOKEN_THRESHOLD`, summarisation switches to
map-reduce: chunk → summarise chunks → summarise the summaries.
"""

import json
import json_repair
import logging
import os

from google import genai
from google.genai import types
from PIL import Image
from dotenv import load_dotenv

from .chunking import chunk_text
from .retry import with_retry
from .schema import DOC_SUMMARY_SCHEMA
from .tokenizer import count_tokens, truncate_to_tokens

logger = logging.getLogger(__name__)

load_dotenv()

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY", ""))

# ---- limits ----
# Gemini embedding-001 accepts up to 2048 tokens per item. We leave headroom.
EMBED_MAX_TOKENS = 1900
# Above this many input tokens we switch summarisation to map-reduce so we
# don't lose mid-document content to attention bias.
MAP_REDUCE_TOKEN_THRESHOLD = 12_000


# ============================================================================
# Embeddings
# ============================================================================

def _embed_raw(texts: list[str]) -> list[list[float] | None]:
    """One Gemini batched embedding call. Inputs are pre-truncated."""
    result = client.models.embed_content(
        model=os.getenv("EMBEDDING_MODEL", "gemini-embedding-001"),
        contents=texts,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
        output_dimensionality=768,
    )
    vectors: list[list[float] | None] = [e.values for e in result.embeddings]
    while len(vectors) < len(texts):
        vectors.append(None)
    return vectors


def get_embeddings_batch(texts: list[str]) -> list[list[float] | None]:
    """Embed many texts in a single API call.

    - Filters empty inputs.
    - Truncates each text to the embedding model's max input window.
    - Retries on transient errors with exponential backoff.
    - Returns aligned list (None for failed/skipped items).
    """
    if not texts:
        return []
    prepared = [truncate_to_tokens(t, EMBED_MAX_TOKENS) for t in texts if isinstance(t, str) and t.strip()]
    if not prepared:
        return []
    try:
        return with_retry(_embed_raw, prepared, label="embed_batch")
    except Exception as e:
        logger.error(f"get_embeddings_batch failed for {len(prepared)} items: {e}", exc_info=True)
        return [None] * len(prepared)


def get_embedding(text):
    out = get_embeddings_batch([text])
    return out[0] if out else None


# ============================================================================
# Summarisation
# ============================================================================

def _gemini_json(prompt: str, *, schema=None, max_tokens: int = 4096) -> dict | None:
    """Single Gemini call returning a parsed dict (schema-enforced if provided)."""
    config_args = {
        "temperature": 0.2,
        "max_output_tokens": max_tokens,
    }
    if schema is not None:
        config_args["response_mime_type"] = "application/json"
        config_args["response_schema"] = schema

    response = with_retry(
        client.models.generate_content,
        model=os.getenv("LLM_MODEL", "gemini-2.5-flash"),
        contents=prompt,
        config=types.GenerateContentConfig(**config_args),
        label="gemini_json",
    )
    parsed = getattr(response, "parsed", None)
    if parsed:
        return parsed
    raw = getattr(response, "text", None)
    if not raw:
        return None
    try:
        return json_repair.loads(raw)
    except Exception as e:
        logger.error(f"_gemini_json: could not parse model output: {e}")
        return None


def _gemini_text(prompt: str, *, max_tokens: int = 2048) -> str | None:
    response = with_retry(
        client.models.generate_content,
        model=os.getenv("LLM_MODEL", "gemini-2.5-flash"),
        contents=prompt,
        config=types.GenerateContentConfig(temperature=0.2, max_output_tokens=max_tokens),
        label="gemini_text",
    )
    return getattr(response, "text", None)


_DOC_PROMPT = """You are an expert Data Analyst.

Task:
Analyze the provided content and extract insights strictly according to the JSON schema.

**Field Guidelines:**
1. 'executive_overview': A concise 2-5 sentence summary of the main points.
2. 'key_insights': A list of 3-5 bullet points highlighting key insights.
3. 'index_json':
   - 'relevant_dates': Normalize to YYYY-MM-DD where possible.
   - 'entities': People, Companies, and Key Stakeholders.
   - 'document_ids': Invoice #s, PO #s, or Reference IDs.
   - 'technical_topics': Tech stack, products, or domain jargon.

--- Begin Content ---
{content}
--- End Content ---
"""

_MERGE_PROMPT = """You are an expert Data Analyst consolidating partial summaries of a long document.

You'll receive several JSON objects, each summarising a different region of the same document.
Merge them into one final JSON object that follows the same schema. Rules:

- 'executive_overview': write a fresh 2-5 sentence overview covering the whole document, not a concatenation.
- 'key_insights': 3-5 bullets covering the most important points across all regions; deduplicate.
- 'index_json' arrays: take the union, deduplicate while preserving meaningful order. Drop duplicates that differ only by case/whitespace.

--- Partial Summaries (JSON list) ---
{content}
--- End Partial Summaries ---
"""


def _empty_index() -> dict:
    return {"relevant_dates": [], "entities": [], "document_ids": [], "technical_topics": []}


def _format_summary(data: dict) -> tuple[str, dict]:
    overview = data.get("executive_overview", "No overview generated.")
    insights = data.get("key_insights", []) or []
    user_summary = f"{overview}\n\n" + "\n".join([f"- {i}" for i in insights])
    index_json = data.get("index_json", {}) or _empty_index()
    return user_summary, index_json


def LLM_doc_summarize(text: str) -> tuple[str | None, dict | None]:
    """Summarise a document. Returns (summary, index_json) or (None, None).

    Auto-switches to map-reduce when the document exceeds
    MAP_REDUCE_TOKEN_THRESHOLD so we don't lose mid-doc content to attention
    bias on a single huge prompt.
    """
    if not text or not text.strip():
        logger.warning("LLM_doc_summarize received empty text. Skipping API call.")
        return None, None

    total = count_tokens(text)

    if total <= MAP_REDUCE_TOKEN_THRESHOLD:
        try:
            data = _gemini_json(_DOC_PROMPT.format(content=text), schema=DOC_SUMMARY_SCHEMA)
        except Exception as e:
            logger.error(f"LLM_doc_summarize single-pass failed: {e}", exc_info=True)
            return None, None
        if not data:
            return None, None
        return _format_summary(data)

    # Map-reduce path: summarise each large-ish chunk, then merge.
    logger.info(f"LLM_doc_summarize: doc has {total} tokens > {MAP_REDUCE_TOKEN_THRESHOLD}, using map-reduce")
    map_chunks = chunk_text(text, target_tokens=4000, overlap_tokens=200)
    partials: list[dict] = []
    for c in map_chunks:
        try:
            part = _gemini_json(_DOC_PROMPT.format(content=c.text), schema=DOC_SUMMARY_SCHEMA)
            if part:
                partials.append(part)
        except Exception as e:
            logger.warning(f"map-reduce chunk {c.index} failed (skipped): {e}")
    if not partials:
        return None, None

    # Reduce step. Bound the merge prompt size so we don't blow up on truly enormous docs.
    serialized = json.dumps(partials, ensure_ascii=False)
    serialized = truncate_to_tokens(serialized, MAP_REDUCE_TOKEN_THRESHOLD)
    try:
        merged = _gemini_json(_MERGE_PROMPT.format(content=serialized), schema=DOC_SUMMARY_SCHEMA)
    except Exception as e:
        logger.error(f"LLM_doc_summarize reduce step failed: {e}", exc_info=True)
        # Fall back to first partial so the file isn't a total loss.
        return _format_summary(partials[0])
    if not merged:
        return _format_summary(partials[0])
    return _format_summary(merged)


def LLM_doc_summarizer(text: str):
    """Legacy 3-tuple version kept for older callers."""
    if not text or not text.strip():
        logger.warning("LLM_doc_summarizer received empty text. Skipping API call.")
        return "No content extracted from document.", _empty_index(), []
    summary, index_json = LLM_doc_summarize(text)
    if not summary:
        return "Error generating summary.", _empty_index(), None
    embedding = get_embedding(f"{summary}\n\nKeywords: {json.dumps(index_json or {}, ensure_ascii=False)}")
    return summary, index_json, embedding


_MEDIA_PROMPT = """The following is a transcript from a dialogue, podcast, monologue, speech, or lecture.

Provide a concise summary covering:
1. The main topics discussed.
2. Key points, arguments, or conclusions by each speaker.
3. Action items or unresolved questions.
4. The overall conclusion or call to action.

Output ONLY the summary paragraph — no preamble. Don't refer to speakers as "Speaker 1" unless necessary.

**Transcript:**
{content}
"""

_MEDIA_MERGE_PROMPT = """You're consolidating partial summaries of a long transcript into one summary.

Output ONE well-structured paragraph (not a list) covering the whole transcript:
- main topics discussed
- key points / arguments / conclusions
- action items / unresolved questions
- overall conclusion or call to action

Deduplicate and drop minor repetition. Output ONLY the paragraph.

--- Partial Summaries ---
{content}
--- End ---
"""


def LLM_media_summarizer(text: str) -> tuple[str | None, None]:
    """Summarise an audio/video transcript. Map-reduces for very long content."""
    if not text or not text.strip():
        return None, None
    total = count_tokens(text)
    try:
        if total <= MAP_REDUCE_TOKEN_THRESHOLD:
            summary = _gemini_text(_MEDIA_PROMPT.format(content=text))
            return summary, None
        logger.info(f"LLM_media_summarizer: transcript {total} tokens > threshold, using map-reduce")
        partials: list[str] = []
        for c in chunk_text(text, target_tokens=4000, overlap_tokens=200):
            try:
                p = _gemini_text(_MEDIA_PROMPT.format(content=c.text))
                if p:
                    partials.append(p)
            except Exception as e:
                logger.warning(f"media map-reduce chunk {c.index} failed: {e}")
        if not partials:
            return None, None
        merged = _gemini_text(_MEDIA_MERGE_PROMPT.format(content="\n\n---\n\n".join(partials)))
        return (merged or partials[0]), None
    except Exception as e:
        logger.error(f"LLM_media_summarizer failed: {e}", exc_info=True)
        return None, None


_IMAGE_PROMPT = """The following text was extracted from an image using OCR and may contain errors or be out of order.

First, mentally reconstruct it into a clean coherent document.
Then output ONLY a concise summary paragraph — no preamble, no reconstructed text.

**Raw OCR Text:**
{content}
"""


def LLM_image_summarizer(text: str) -> tuple[str | None, None]:
    if not text or not text.strip():
        return None, None
    try:
        return _gemini_text(_IMAGE_PROMPT.format(content=text)), None
    except Exception as e:
        logger.error(f"LLM_image_summarizer failed: {e}", exc_info=True)
        return None, None


_CAPTION_PROMPT = """Provide a comprehensive, detailed description of the following image. Cover:

* **Main Subject(s):** Who/what is the focus. Appearance, clothing, actions.
* **Setting & Background:** Where it's taking place. Environment, time of day, landmarks.
* **Composition & Mood:** Composition, lighting, overall mood.
* **Other Details:** Notable objects, animals, text, or details.

Output a single well-structured concise paragraph."""


def LLM_caption_generator(image_path: str) -> tuple[str | None, None]:
    try:
        with Image.open(image_path) as img:
            response = with_retry(
                client.models.generate_content,
                model=os.getenv("LLM_MODEL", "gemini-2.5-flash"),
                contents=[_CAPTION_PROMPT, img],
                label="gemini_caption",
            )
        return getattr(response, "text", None), None
    except Exception as e:
        logger.error(f"LLM_caption_generator failed: {e}", exc_info=True)
        return None, None
