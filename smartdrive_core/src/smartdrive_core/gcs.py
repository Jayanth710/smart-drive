import os
import logging
from google.cloud import storage
from google.oauth2 import service_account

logger = logging.getLogger(__name__)

_storage_client = None

def get_storage_client():
    global _storage_client
    if _storage_client is not None:
        return _storage_client

    creds = None
    # Cloud Run: use default credentials (recommended)
    if not os.getenv("K_SERVICE"):
        path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "smartdrive-service-account.json")
        try:
            creds = service_account.Credentials.from_service_account_file(path)
            logger.info(f"GCS: Loaded local service account credentials from {path}")
        except Exception as e:
            logger.warning(f"GCS: Could not load local credentials, using defaults: {e}")

    _storage_client = storage.Client(credentials=creds)
    return _storage_client


def parse_gcs_http_url(gcs_url: str):
    """
    Supports: https://storage.googleapis.com/<bucket>/<blob>
    Returns: (bucket, blob)
    """
    prefix = "https://storage.googleapis.com/"
    if not gcs_url or not gcs_url.startswith(prefix):
        raise ValueError("Invalid GCS URL format. Expected https://storage.googleapis.com/<bucket>/<blob>")

    parts = gcs_url[len(prefix):].split("/", 1)
    bucket_name = parts[0]
    blob_name = parts[1] if len(parts) > 1 else ""
    if not bucket_name or not blob_name:
        raise ValueError("Invalid GCS URL: missing bucket/blob")
    return bucket_name, blob_name


def download_to_tmp(gcs_url: str, file_name: str) -> str:
    """
    Downloads file to /tmp and returns local path.
    """
    output_dir = "/tmp"
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, file_name)

    bucket_name, blob_name = parse_gcs_http_url(gcs_url)
    logger.info(f"GCS: Downloading gs://{bucket_name}/{blob_name} -> {output_path}")

    client = get_storage_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    blob.download_to_filename(output_path)

    logger.info(f"GCS: Downloaded {file_name} to {output_path}")
    return output_path


def download_and_process(data: dict, processor_fn):
    """
    Shared flow:
      1) download from gcsUrl to /tmp
      2) call processor_fn(local_path, data)
      3) normalize response
    """
    gcs_url = data.get("gcsUrl")
    file_name = data.get("fileName")

    try:
        if not gcs_url or not file_name:
            return {"created": False, "message": "Missing gcsUrl or fileName", "url": None}

        local_path = download_to_tmp(gcs_url, file_name)

        # Call service-specific logic
        # res = processor_fn(local_path, data)  # must return dict with created/message
        logger.info(f"➡️ About to run processor_fn on {local_path}")
        res = processor_fn(local_path, data)
        logger.info(f"✅ processor_fn returned for {file_name}")
        if not isinstance(res, dict):
            return {"created": False, "message": "Processor returned invalid response", "url": None}

        if not res.get("created"):
            return {"created": False, "message": res.get("message", "Processing failed"), "url": None}

        return {"created": True, "message": res.get("message", "OK"), "url": gcs_url}

    except Exception as e:
        logger.error(f"GCS: Failed for {file_name}: {e}", exc_info=True)
        return {"created": False, "message": f"Failed for {file_name}: {e}", "url": None}
    finally:
        # Optional cleanup: keep or delete local file
        # If you want to delete always:
        try:
            if file_name:
                tmp_path = os.path.join("/tmp", file_name)
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
        except Exception:
            pass