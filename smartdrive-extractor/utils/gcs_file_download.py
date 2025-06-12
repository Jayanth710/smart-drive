# import io
# from google.cloud import storage
# import os
# from helper_functions.file_extractor import extract_data_from_pdf
# from google.oauth2 import service_account

# isLocal = os.getenv("NODE_ENV")
# if(isLocal=='dev'):
#     credentials = service_account.Credentials.from_service_account_file(
#     "smartdrive-service-account.json")
# else:
#     credentials = None

# def download_from_gcs(gcs_url: str, file_name: str, output_dir="uploads") -> str:
#     # Parse bucket and blob from URL
#     parts = gcs_url.split("/")
#     bucket_name = parts[3]
#     blob_name = "/".join(parts[4:])

#     os.makedirs(output_dir, exist_ok=True)
#     output_path = os.path.join(output_dir, file_name)

#     # Initialize GCS client
#     if(credentials is None):
#         client = storage.Client()
#     else:
#         client = storage.Client(credentials=credentials)
#     client = storage.Client(credentials=credentials)
#     bucket = client.bucket(bucket_name)
#     blob = bucket.blob(blob_name)

#     # Download file
#     blob.download_to_filename(output_path)
#     print(f"📥 Downloaded {file_name} to {output_path}")
#     extract_data_from_pdf(output_path)

#     return output_path
import os
from google.cloud import storage
from google.oauth2 import service_account
from helper_functions.file_extractor import extract_data_from_pdf
import logging

logger = logging.getLogger(__name__)

credentials = None

# This is the standard way to check if we are in a Google Cloud serverless environment.
if not os.getenv('K_SERVICE'):
    # This block will only run on your local machine.
    try:
        credentials = service_account.Credentials.from_service_account_file(
            "smartdrive-service-account.json"
        )
        logger.info("GCS Downloader: Loaded local service account credentials.")
    except Exception as e:
        logger.warning(f"GCS Downloader: Could not load local credentials, using defaults: {e}")

# This will now use the correct credentials in both environments.
storage_client = storage.Client(credentials=credentials)


def download_from_gcs(gcs_url: str, file_name: str) -> str:
    """
    Downloads a file from GCS to the /tmp/ directory for processing.
    The /tmp/ directory is the only writable part of the filesystem in Cloud Run.
    """
    try:
        # --- THIS IS THE FIX for the filesystem error ---
        # We must use the /tmp/ directory in Cloud Run.
        output_dir = "/tmp" 
        
        # Ensure the output directory exists (it should for /tmp, but this is safe)
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, file_name)

        # Parse bucket and blob from the GCS URL
        if not gcs_url.startswith("https://storage.googleapis.com/"):
            raise ValueError("Invalid GCS URL format.")
        
        parts = gcs_url.replace("https://storage.googleapis.com/", "").split("/")
        bucket_name = parts[0]
        blob_name = "/".join(parts[1:])

        logger.info(f"Attempting to download gs://{bucket_name}/{blob_name} to {output_path}")

        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(blob_name)

        # Download the file to the temporary path
        blob.download_to_filename(output_path)
        logger.info(f"📥 Downloaded {file_name} to {output_path}")
        
        # Now process the downloaded file
        extract_data_from_pdf(output_path)

        return output_path

    except Exception as e:
        # Log the specific error that is happening
        logger.error(f"❌ Failed during GCS download or processing for {file_name}: {e}", exc_info=True)
        # Re-raise the exception to ensure the message is NOT acknowledged
        return