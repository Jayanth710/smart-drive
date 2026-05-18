"""Weaviate schema + save helpers for the media extractor.

One summary per file in SmartDriveMedia, plus per-chunk vectors in
SmartDriveMediaChunks (transcripts get long fast — chunking is essential).
"""

import weaviate.classes as wvc
from smartdrive_core import weaviate_client as ws

MEDIA_COLLECTION = "SmartDriveMedia"
MEDIA_CHUNK_COLLECTION = "SmartDriveMediaChunks"

MEDIA_PROPS = [
    wvc.config.Property(name="file_id", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="user_id", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="summary", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="raw_text", data_type=wvc.config.DataType.TEXT, index_searchable=False),
    wvc.config.Property(name="filename", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="filetype", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="created_at", data_type=wvc.config.DataType.DATE, index_filterable=True),
    wvc.config.Property(name="chunk_count", data_type=wvc.config.DataType.INT),
    # Private media files were never transcribed or summarized — only the
    # filename is meaningfully indexed. Audio bytes never reach an LLM.
    wvc.config.Property(name="is_private", data_type=wvc.config.DataType.BOOL, index_filterable=True),
]

CHUNK_PROPS = [
    wvc.config.Property(name="file_id", data_type=wvc.config.DataType.TEXT, index_filterable=True),
    wvc.config.Property(name="user_id", data_type=wvc.config.DataType.TEXT, index_filterable=True),
    wvc.config.Property(name="chunk_index", data_type=wvc.config.DataType.INT),
    wvc.config.Property(name="chunk_text", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="filename", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="filetype", data_type=wvc.config.DataType.TEXT),
    wvc.config.Property(name="created_at", data_type=wvc.config.DataType.DATE, index_filterable=True),
]


def init_schema():
    ws.ensure_collection(MEDIA_COLLECTION, MEDIA_PROPS)
    ws.ensure_collection(MEDIA_CHUNK_COLLECTION, CHUNK_PROPS)


_PRIVATE_PLACEHOLDER_SUMMARY = "Private media — content not indexed."
_PRIVATE_ZERO_VECTOR_DIM = 768  # match gemini-embedding-001 output dim


def save_media_private(data: dict) -> dict:
    """Write a minimal filename-only stub for a private media file. The audio
    is never transcribed and never sent to any LLM."""
    init_schema()
    props = {
        "filename": data.get("fileName"),
        "file_id": str(data.get("_id")),
        "user_id": data.get("userId"),
        "summary": _PRIVATE_PLACEHOLDER_SUMMARY,
        "raw_text": "",
        "filetype": data.get("fileType"),
        "created_at": data.get("uploadedAt"),
        "chunk_count": 0,
        "is_private": True,
    }
    return ws.upload(MEDIA_COLLECTION, props, [0.0] * _PRIVATE_ZERO_VECTOR_DIM)


def save_media(data: dict, summary: str, embedding, raw_text: str = "", chunk_count: int = 0) -> dict:
    init_schema()
    props = {
        "filename": data.get("fileName"),
        "file_id": str(data.get("_id")),
        "user_id": data.get("userId"),
        "summary": summary,
        "raw_text": raw_text or "",
        "filetype": data.get("fileType"),
        "created_at": data.get("uploadedAt"),
        "chunk_count": int(chunk_count),
    }
    return ws.upload(MEDIA_COLLECTION, props, embedding)


def save_media_chunks(data: dict, chunks_with_vectors: list[tuple[int, str, list[float] | None]]) -> dict:
    init_schema()
    file_id = str(data.get("_id"))
    user_id = data.get("userId")
    ws.delete_by_file_id(MEDIA_CHUNK_COLLECTION, user_id, file_id)
    base = {
        "file_id": file_id,
        "user_id": user_id,
        "filename": data.get("fileName"),
        "filetype": data.get("fileType"),
        "created_at": data.get("uploadedAt"),
    }
    items = []
    for idx, text, vec in chunks_with_vectors:
        if not vec or not text:
            continue
        items.append(({**base, "chunk_index": int(idx), "chunk_text": text}, vec))
    return ws.upload_many(MEDIA_CHUNK_COLLECTION, items)
