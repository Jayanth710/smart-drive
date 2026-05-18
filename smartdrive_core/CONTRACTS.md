# Extraction service contracts

Single source of truth for the message shapes, error codes, and Weaviate
schemas that flow between the backend and the worker fleet. If you change a
field here, change it in **all** producers and consumers (or accept the
ingest will silently drop the field).

---

## Pub/Sub message: `FileExtractionMessage`

Published by `backend/src/utils/pubsub.ts → publishFileMetadata` to one of:

| Topic | Subscription | Consumer |
|---|---|---|
| `smartdrive-data-extract` | `smartdrive-data-extract-sub` | `smartdrive-extractor` |
| `smartdrive-media-extract` | `smartdrive-media-extract-sub` | `smartdrive-media-extractor` |

Payload (camelCase JSON):

```json
{
  "_id":        "<Mongo ObjectId as string>",
  "userId":     "<Mongo ObjectId as string>",
  "fileName":   "string (whitespace normalised to _)",
  "fileType":   "string (mime, lowercased)",
  "gcsUrl":     "https://storage.googleapis.com/<bucket>/<blob>",
  "uploadedAt": "ISO 8601 string"
}
```

Workers should parse via `smartdrive_core.messages.FileExtractionMessage.from_pubsub(data)`.

---

## Extraction status (`UserFile.extractionStatus` in Mongo)

| Value | Meaning |
|---|---|
| `pending`     | Created in Mongo, message published, worker has not started yet. |
| `processing`  | Worker has picked up the message and is mid-pipeline. |
| `done`        | Indexed in Weaviate. UI can show summary / search hits. |
| `failed`      | Pipeline gave up. See `UserFile.extractionError` for details. |

Workers update via `smartdrive_core.mongo_status.update_status(file_id, status, error=)`.

---

## Error taxonomy (`ExtractionError`)

Stored alongside `failed` status so the UI can hint at the right retry path.

| Code | When it fires |
|---|---|
| `download_failed`     | GCS download problem (perm, missing blob). |
| `extraction_failed`   | docling / ffmpeg / OCR couldn't parse the file. |
| `no_content`          | Parsed cleanly but the text/transcript was empty. |
| `llm_failed`          | Gemini summarisation error (rate-limit, schema mismatch). |
| `embedding_failed`    | Gemini embedding API returned None. |
| `storage_failed`      | Weaviate insert error. |
| `unsupported_type`    | Mime type isn't handled by this worker. |
| `invalid_message`     | Pub/Sub payload missing required fields. |
| `unknown`             | Anything we didn't classify. |

---

## Weaviate collections

Two collections per content type: one row per file in the summary collection,
many rows per file in the chunks collection. Search hits chunks; we dedupe to
parent at query time.

### Summary collections

| Collection | Contains |
|---|---|
| `SmartDriveDocuments` | One row per PDF/doc. Properties: `file_id, user_id, summary, raw_text, filename, filetype, created_at, index_json, chunk_count`. Vector = embedding of `summary + index_json`. |
| `SmartDriveImages` | One row per image. Properties: same as above (minus `index_json`), plus `processing_type` (`OCR` / `CAPTION`). |
| `SmartDriveMedia` | One row per audio/video. Properties: same as Documents (minus `index_json`). |

### Chunk collections

| Collection | Contains |
|---|---|
| `SmartDriveDocumentChunks` | Per-chunk vectors for docs. Properties: `file_id, user_id, chunk_index, chunk_text, filename, filetype, created_at`. Vector = embedding of `chunk_text`. |
| `SmartDriveMediaChunks` | Per-chunk vectors for transcripts. Same shape. |
| `SmartDriveImageChunks` | Reserved for future image chunking (we currently store one row per image in the summary collection only). |

### `index_json` shape (documents only)

Stored as a JSON string in the `index_json` property; the backend parses it
on read.

```jsonc
{
  "relevant_dates":    ["YYYY-MM-DD", ...],
  "entities":          ["People, companies, key stakeholders"],
  "document_ids":      ["Invoice #s, PO #s, contract IDs"],
  "technical_topics":  ["Tech stack, products, domain jargon"]
}
```

---

## Stage timings

Workers wrap each stage with `smartdrive_core.metrics.stage_timer`. Log lines
look like `stage_done stage=<name> ms=<duration> file_id=<id> ...`.

| Stage | Worker | What it does |
|---|---|---|
| `extract` | docs/images | docling text + table extraction |
| `summarize` | all | Gemini JSON-schema generation |
| `embed_summary` | all | Single Gemini embedding for the parent row |
| `embed_chunks` | docs/media | Batched Gemini embeddings for chunks |
| `save_summary` | all | Weaviate single-object insert into summary collection |
| `save_chunks` | docs/media | Weaviate `insert_many` into chunks collection |
| `transcribe` | media | Whisper transcription |
| `video_to_audio` | media | ffmpeg passthrough |

---

## Dead-letter queue (TODO infra)

We don't have one yet. Workers nack on transient failure (`modify_ack_deadline=0`)
which retries forever. When ready:

1. Create a dead-letter topic per primary topic:
   - `smartdrive-data-extract-dlq`
   - `smartdrive-media-extract-dlq`
2. Update each subscription's `dead_letter_policy` with `max_delivery_attempts=5`.
3. Add a daily cron that reads from the DLQ subs and surfaces failed file_ids
   in a dashboard (or in the UI under a "Permanently failed" filter).
