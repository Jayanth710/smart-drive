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
        logger.info(f"Collection '{collection_name}' already exists.")
        return

    logger.info(f"Creating collection '{collection_name}'...")
    client.collections.create(
        name=collection_name,
        properties=properties,
        vectorizer_config=wvc.config.Configure.Vectorizer.none(),
    )
    logger.info(f"Collection '{collection_name}' created.")

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