# smartdrive_core/weaviate_client.py
import os
import logging
import threading
import weaviate
import weaviate.classes as wvc
from weaviate.classes.query import Filter

logger = logging.getLogger(__name__)

_client = None
_collections: dict[str, object] = {}

_client_lock = threading.Lock()
_collections_lock = threading.Lock()

def _validate_weaviate_url(url: str) -> str:
    url = url.strip()
    if not url.startswith("http"):
        url = "https://" + url
    # IMPORTANT: Weaviate Cloud URL should NOT include /v1
    url = url.rstrip("/")
    if url.endswith("/v1"):
        url = url[:-3]
    return url

def get_weaviate_client():
    global _client
    with _client_lock:
        if _client is not None:
            try:
                if _client.is_live():
                    return _client
            except Exception:
                pass

        url = os.getenv("WEAVIATE_URL")
        api_key = os.getenv("WEAVIATE_API_KEY")
        if not url or not api_key:
            raise RuntimeError("WEAVIATE_URL / WEAVIATE_API_KEY not set")

        url = _validate_weaviate_url(url)
        logger.info(f"Connecting to Weaviate: {url}")

        _client = weaviate.connect_to_weaviate_cloud(
            cluster_url=url,
            auth_credentials=weaviate.auth.AuthApiKey(api_key),
        )
        return _client

def _get_collection(collection_name: str):
    # fast path without holding lock during connect
    with _collections_lock:
        col = _collections.get(collection_name)
    if col is not None:
        return col

    client = get_weaviate_client()  # may do network; no collections lock held

    col = client.collections.get(collection_name)

    with _collections_lock:
        _collections[collection_name] = col
    return col

def ensure_collection(collection_name: str, properties: list[wvc.config.Property]):
    client = get_weaviate_client()
    if client.collections.exists(collection_name):
        # Existing collection: additively add any properties we don't yet have.
        # Weaviate refuses to drop or change types of existing properties — that's fine.
        _ensure_properties(collection_name, properties)
        return

    logger.info(f"Creating collection '{collection_name}'...")
    client.collections.create(
        name=collection_name,
        properties=properties,
        vectorizer_config=wvc.config.Configure.Vectorizer.none(),
    )
    logger.info(f"Collection '{collection_name}' created.")


def _ensure_properties(collection_name: str, properties: list[wvc.config.Property]):
    """Add any missing properties to an existing collection (idempotent)."""
    try:
        col = get_weaviate_client().collections.get(collection_name)
        existing = col.config.get()
        existing_names = {p.name for p in (existing.properties or [])}
        for prop in properties:
            if prop.name in existing_names:
                continue
            try:
                col.config.add_property(prop)
                logger.info(f"Added property '{prop.name}' to collection '{collection_name}'")
            except Exception as e:
                logger.warning(f"Could not add property '{prop.name}' to '{collection_name}': {e}")
    except Exception as e:
        logger.warning(f"_ensure_properties for {collection_name} failed: {e}")

def check_file_exists(collection_name: str, file_id: str, user_id: str) -> bool:
    try:
        col = _get_collection(collection_name)
        filters = Filter.all_of([
            wvc.Filter.by_property("file_id").equal(file_id),
            wvc.Filter.by_property("user_id").equal(user_id),
        ])
        resp = col.query.fetch_objects(limit=1, filters=filters)
        return bool(resp and resp.objects)
    except Exception as e:
        logger.error(f"check_file_exists failed: {e}", exc_info=True)
        # If exists-check fails, return False so pipeline can proceed (or you can return True to be conservative)
        return False

def upload(collection_name: str, properties_to_save: dict, embedding: list[float]) -> dict:
    col = _get_collection(collection_name)
    uuid = col.data.insert(properties=properties_to_save, vector={"default": embedding})
    logger.info(f"Saved to {collection_name} UUID={uuid}")
    return {"created": True, "uuid": str(uuid), "message": f"Saved to {collection_name}"}


def upload_many(
    collection_name: str,
    items: list[tuple[dict, list[float]]],
) -> dict:
    """Batch-insert (props, vector) pairs into a collection.

    Skips items whose vector is None (e.g. failed embeddings) — they'd
    otherwise pollute the index with junk.
    """
    valid = [(props, vec) for props, vec in items if vec]
    skipped = len(items) - len(valid)
    if not valid:
        return {"created": False, "inserted": 0, "skipped": skipped, "message": "No valid items"}

    col = _get_collection(collection_name)
    objects = [wvc.data.DataObject(properties=p, vector={"default": v}) for p, v in valid]
    try:
        result = col.data.insert_many(objects)
        has_errors = bool(getattr(result, "has_errors", False))
        if has_errors:
            errs = getattr(result, "errors", {})
            logger.warning(f"upload_many to {collection_name}: had errors: {errs}")
        inserted = len(valid) - (len(getattr(result, "errors", {})) if has_errors else 0)
        logger.info(f"upload_many to {collection_name}: inserted={inserted} skipped={skipped}")
        return {
            "created": inserted > 0,
            "inserted": inserted,
            "skipped": skipped,
            "message": f"Inserted {inserted}/{len(items)} into {collection_name}",
        }
    except Exception as e:
        logger.error(f"upload_many to {collection_name} failed: {e}", exc_info=True)
        return {"created": False, "inserted": 0, "skipped": len(items), "message": str(e)}


def delete_by_file_id(collection_name: str, user_id: str, file_id: str) -> int:
    """Delete every object in a collection matching this (user_id, file_id) — used
    when re-running extraction to avoid duplicate chunks."""
    try:
        col = _get_collection(collection_name)
        filters = Filter.all_of([
            wvc.Filter.by_property("file_id").equal(file_id),
            wvc.Filter.by_property("user_id").equal(user_id),
        ])
        before = col.query.fetch_objects(limit=1, filters=filters)
        if not before or not before.objects:
            return 0
        result = col.data.delete_many(where=filters)
        matched = getattr(result, "matches", 0) or 0
        logger.info(f"delete_by_file_id {collection_name}: deleted {matched} for file_id={file_id}")
        return matched
    except Exception as e:
        logger.warning(f"delete_by_file_id {collection_name} for file_id={file_id} failed: {e}")
        return 0