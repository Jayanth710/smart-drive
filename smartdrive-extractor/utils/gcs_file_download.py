import os
from google.cloud import storage
from google.oauth2 import service_account
from helper_functions.file_extractor import file_extractor
import logging

logger = logging.getLogger(__name__)

credentials = None

if not os.getenv('K_SERVICE'):
    try:
        credentials = service_account.Credentials.from_service_account_file(
            "smartdrive-service-account.json"
        )
        logger.info("GCS Downloader: Loaded local service account credentials.")
    except Exception as e:
        logger.warning(f"GCS Downloader: Could not load local credentials, using defaults: {e}")

storage_client = storage.Client(credentials=credentials)


def download_from_gcs(data: dict) -> str:
    """
    Downloads a file from GCS to the /tmp/ directory for processing.
    The /tmp/ directory is the only writable part of the filesystem in Cloud Run.
    """
    gcs_url = data.get("fileUrl")
    file_name = data.get("fileName")
    try:
        output_dir = "/tmp" 
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, file_name)

        if not gcs_url.startswith("https://storage.googleapis.com/"):
            raise ValueError("Invalid GCS URL format.")
        
        parts = gcs_url.replace("https://storage.googleapis.com/", "").split("/")
        bucket_name = parts[0]
        blob_name = "/".join(parts[1:])

        logger.info(f"Attempting to download gs://{bucket_name}/{blob_name} to {output_path}")

        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(blob_name)

        blob.download_to_filename(output_path)
        logger.info(f"📥 Downloaded {file_name} to {output_path}")


        
        res = file_extractor(output_path, data)

        if(not res.get("created")):
            return {
                "message": res.get("message"),
                "url": None
            }


        return {
            "message": res.get("message"),
            "url": gcs_url
        }

    except Exception as e:
        logger.error(f"❌ Failed during GCS download or processing for {file_name}: {e}", exc_info=True)
        return {
            "message": f"❌ Failed during GCS download or processing for {file_name}: {e}",
            "url": None
        }