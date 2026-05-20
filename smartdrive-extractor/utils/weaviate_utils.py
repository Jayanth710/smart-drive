"""Weaviate schema + save helpers for the document/image extractor.

Two collections per content type:
  - <Doc/Image/Media>: one row per file with summary + raw_text + index_json
    (used for the file list, drawer summary, entity panel)
  - <Doc/Image/Media>Chunks: one row per chunk with chunk_text + chunk_index
    (used for semantic search; we de-dup to parent file_id at query time)
"""

import json
import weaviate.classes as wvc
from smartdrive_core import weaviate_client as ws


def _norm_list(values) -> list[str]:
    """Normalise an index_json array into lowercase trimmed unique strings.

    Lowercasing matters for filter matching — Weaviate `contains_any` is
    case-sensitive, and we extract entities from user queries lowercased.
    """
    if not isinstance(values, list):
        return []
    seen = set()
    out: list[str] = []
    for v in values:
        if not isinstance(v, str):
            continue
        normalized = v.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    return out

# ---- collection names ----
DOC_COLLECTION = "SmartDriveDocuments"
DOC_CHUNK_COLLECTION = "SmartDriveDocumentChunks"

IMG_COLLECTION = "SmartDriveImages"
IMG_CHUNK_COLLECTION = "SmartDriveImageChunks"

# ---- schemas ----
DOC_PROPERTIES = [
    wvc.config.Property(name="file_id", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="user_id", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="summary", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="raw_text", data_type=wvc.config.DataType.TEXT, index_searchable=False),
    # R3 — searchable body text. raw_text was marked index_searchable=False
    # (storage-only), which silently broke BM25 over body content for files
    # without chunks. We add a searchable mirror; backend uses this for
    # body-text BM25 queries. Auto-populated alongside raw_text below.
    wvc.config.Property(name="body_text", data_type=wvc.config.DataType.TEXT, index_searchable=True),
    wvc.config.Property(name="filename", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="filetype", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="created_at", data_type=wvc.config.DataType.DATE, index_filterable=True),
    wvc.config.Property(name="index_json", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="chunk_count", data_type=wvc.config.DataType.INT),
    # Filterable arrays for high-precision search ("the file where Acme Corp
    # mentioned Q3 2025"). Mirrors what's inside `index_json` but queryable.
    wvc.config.Property(name="entities", data_type=wvc.config.DataType.TEXT_ARRAY, index_filterable=True),
    wvc.config.Property(name="dates", data_type=wvc.config.DataType.TEXT_ARRAY, index_filterable=True),
    wvc.config.Property(name="doc_ids", data_type=wvc.config.DataType.TEXT_ARRAY, index_filterable=True),
    wvc.config.Property(name="topics", data_type=wvc.config.DataType.TEXT_ARRAY, index_filterable=True),
    # When True, this file was uploaded as "private" — no LLM ran on it. Only
    # filename is meaningfully indexed. Search must still return it on filename
    # match, but body/summary signals will be empty.
    wvc.config.Property(name="is_private", data_type=wvc.config.DataType.BOOL, index_filterable=True),
]

CHUNK_PROPERTIES = [
    wvc.config.Property(name="file_id", data_type=wvc.config.DataType.TEXT, index_filterable=True),
    wvc.config.Property(name="user_id", data_type=wvc.config.DataType.TEXT, index_filterable=True),
    wvc.config.Property(name="chunk_index", data_type=wvc.config.DataType.INT),
    wvc.config.Property(name="chunk_text", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="filename", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="filetype", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="created_at", data_type=wvc.config.DataType.DATE, index_filterable=True),
]

IMG_PROPERTIES = [
    wvc.config.Property(name="file_id", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="user_id", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="summary", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="raw_text", data_type=wvc.config.DataType.TEXT, index_searchable=False),
    # R3 — searchable body mirror (see DOC_PROPERTIES for explanation).
    wvc.config.Property(name="body_text", data_type=wvc.config.DataType.TEXT, index_searchable=True),
    wvc.config.Property(name="filename", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="filetype", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="created_at", data_type=wvc.config.DataType.DATE, index_filterable=True),
    wvc.config.Property(name="processing_type", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="is_private", data_type=wvc.config.DataType.BOOL, index_filterable=True),
]


def init_schema():
    ws.ensure_collection(DOC_COLLECTION, DOC_PROPERTIES)
    ws.ensure_collection(DOC_CHUNK_COLLECTION, CHUNK_PROPERTIES)


def init_image_schema():
    ws.ensure_collection(IMG_COLLECTION, IMG_PROPERTIES)
    ws.ensure_collection(IMG_CHUNK_COLLECTION, CHUNK_PROPERTIES)


_PRIVATE_PLACEHOLDER_SUMMARY = "Private file — content not indexed."

# Match the embedding model's output dimensions (gemini-embedding-001 → 768).
# A zero vector is fine: vector search filtered to is_private=False ignores
# these rows, and is_private=True rows are reached only via filename BM25.
_PRIVATE_ZERO_VECTOR_DIM = 768


def save_doc_private(data):
    """Write a minimal stub for a private document — no LLM was called, so we
    have no summary, no entities, no chunks. The filename is still indexed so
    the user can find the file by name."""
    init_schema()
    props = {
        "filename": data["fileName"],
        "file_id": str(data["_id"]),
        "user_id": data["userId"],
        "summary": _PRIVATE_PLACEHOLDER_SUMMARY,
        "raw_text": "",
        "body_text": "",  # R3 — searchable mirror (empty for private/stub files)
        "index_json": "{}",
        "filetype": data.get("fileType"),
        "created_at": data.get("uploadedAt"),
        "chunk_count": 0,
        "entities": [],
        "dates": [],
        "doc_ids": [],
        "topics": [],
        "is_private": True,
    }
    return ws.upload(DOC_COLLECTION, props, [0.0] * _PRIVATE_ZERO_VECTOR_DIM)


def save_doc(data, summary, index_json, embedding, raw_text: str = "", chunk_count: int = 0):
    init_schema()
    idx = index_json or {}
    props = {
        "filename": data["fileName"],
        "file_id": str(data["_id"]),
        "user_id": data["userId"],
        "summary": summary,
        "raw_text": raw_text or "",
        "body_text": raw_text or "",  # R3 — searchable mirror
        "index_json": json.dumps(idx, ensure_ascii=False),
        "filetype": data.get("fileType"),
        "created_at": data.get("uploadedAt"),
        "chunk_count": int(chunk_count),
        # Mirror entities/dates/doc_ids/topics into filterable arrays so we can
        # answer "files mentioning Acme Corp in Q3 2025"-style queries precisely.
        "entities": _norm_list(idx.get("entities")),
        "dates": _norm_list(idx.get("relevant_dates")),
        "doc_ids": _norm_list(idx.get("document_ids")),
        "topics": _norm_list(idx.get("technical_topics")),
    }
    return ws.upload(DOC_COLLECTION, props, embedding)


def save_doc_chunks(data, chunks_with_vectors: list[tuple[int, str, list[float] | None]]) -> dict:
    """Insert a batch of (chunk_index, chunk_text, vector) for a document.

    Replaces any existing chunks for this file first so a re-extract doesn't
    duplicate them.
    """
    init_schema()
    file_id = str(data["_id"])
    user_id = data["userId"]
    ws.delete_by_file_id(DOC_CHUNK_COLLECTION, user_id, file_id)

    base = {
        "file_id": file_id,
        "user_id": user_id,
        "filename": data["fileName"],
        "filetype": data.get("fileType"),
        "created_at": data.get("uploadedAt"),
    }
    items = []
    for idx, text, vec in chunks_with_vectors:
        if not vec or not text:
            continue
        items.append(({**base, "chunk_index": int(idx), "chunk_text": text}, vec))
    return ws.upload_many(DOC_CHUNK_COLLECTION, items)


def save_image_private(data):
    """Write a minimal stub for a private image — no OCR, no caption, no LLM.
    The filename is still indexed; image bytes never reach an external API."""
    init_image_schema()
    props = {
        "filename": data["fileName"],
        "file_id": str(data["_id"]),
        "user_id": data["userId"],
        "summary": _PRIVATE_PLACEHOLDER_SUMMARY,
        "raw_text": "",
        "body_text": "",  # R3 — searchable mirror (empty for private/stub files)
        "filetype": data.get("fileType"),
        "created_at": data.get("uploadedAt"),
        "processing_type": "private",
        "is_private": True,
    }
    return ws.upload(IMG_COLLECTION, props, [0.0] * _PRIVATE_ZERO_VECTOR_DIM)


def save_image(data, summary, embedding, processing_type, raw_text: str = "", chunk_count: int = 0):
    init_image_schema()
    props = {
        "filename": data["fileName"],
        "file_id": str(data["_id"]),
        "user_id": data["userId"],
        "summary": summary,
        "raw_text": raw_text or "",
        "body_text": raw_text or "",  # R3 — searchable mirror
        "filetype": data.get("fileType"),
        "created_at": data.get("uploadedAt"),
        "processing_type": processing_type,
    }
    return ws.upload(IMG_COLLECTION, props, embedding)


def save_image_chunks(data, chunks_with_vectors: list[tuple[int, str, list[float] | None]]) -> dict:
    """Insert per-chunk vectors for an image's OCR'd text. Replaces any
    existing chunks for this file first so a re-extract doesn't duplicate them."""
    init_image_schema()
    file_id = str(data["_id"])
    user_id = data["userId"]
    ws.delete_by_file_id(IMG_CHUNK_COLLECTION, user_id, file_id)
    base = {
        "file_id": file_id,
        "user_id": user_id,
        "filename": data["fileName"],
        "filetype": data.get("fileType"),
        "created_at": data.get("uploadedAt"),
    }
    items = []
    for idx, text, vec in chunks_with_vectors:
        if not vec or not text:
            continue
        items.append(({**base, "chunk_index": int(idx), "chunk_text": text}, vec))
    return ws.upload_many(IMG_CHUNK_COLLECTION, items)
