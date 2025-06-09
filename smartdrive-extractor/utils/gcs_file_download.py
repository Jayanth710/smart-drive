import io
from google.cloud import storage
import os
from helper_functions.file_extractor import extract_data_from_pdf
from google.oauth2 import service_account

isLocal = os.getenv("NODE_ENV")
if(isLocal=='dev'):
    print('dev')
    credentials = service_account.Credentials.from_service_account_file(
    "smartdrive-service-account.json")
else:
    print('Non dev')
    credentials = None

def download_from_gcs(gcs_url: str, file_name: str, output_dir="uploads") -> str:
    # Parse bucket and blob from URL
    parts = gcs_url.split("/")
    bucket_name = parts[3]
    blob_name = "/".join(parts[4:])

    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, file_name)

    # Initialize GCS client
    if(credentials is None):
        client = storage.Client()
    else:
        client = storage.Client(credentials=credentials)
    client = storage.Client(credentials=credentials)
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)

    # Download file
    blob.download_to_filename(output_path)
    print(f"📥 Downloaded {file_name} to {output_path}")
    extract_data_from_pdf(output_path)

    return output_path