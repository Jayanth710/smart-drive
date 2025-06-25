import json
import logging
import os
from google.cloud import pubsub_v1
from google.oauth2 import service_account
from utils.gcs_file_download import download_from_gcs

logger = logging.getLogger(__name__)

project_id = "smartdrive-461502"
subscription_id = "smartdrive-data-extract-sub"

credentials = None

if not os.getenv('K_SERVICE'):
    try:
        credentials = service_account.Credentials.from_service_account_file(
            "smartdrive-service-account.json"
        )
        logger.info("GCS Downloader: Loaded local service account credentials.")
    except Exception as e:
        logger.warning(f"GCS Downloader: Could not load local credentials, using defaults: {e}")
    
def callback(message: pubsub_v1.subscriber.message.Message) -> None:
    """Processes a single Pub/Sub message."""
    try:
        logger.info(f"Received message with ID: {message.message_id}")
        data = json.loads(message.data.decode("utf-8"))
        
        if "fileUrl" not in data or "fileName" not in data:
            logger.error("Message is missing 'fileUrl' or 'fileName'.")
            message.nack()
            return

        logger.info(f"Downloading {data['fileName']} from {data['fileUrl']}")
        # logger.info(data)
        response = download_from_gcs(data)
        if(response.get("url") is None):
            logger.info(response.get("message"))
        else:
            logger.info(f"{response.get('message')} and URL: {response.get('url')}")
        
        message.ack()
    except json.JSONDecodeError as e:
        logger.error(f"Failed to decode message data: {e}")
        message.nack()
    except Exception as e:
        logger.error(f"❌ Error processing message: {e}", exc_info=True)
        message.nack()

def pubsub():
    """Starts the Pub/Sub subscriber and blocks until an error occurs."""
    try:
        if(credentials is None):
            subscriber = pubsub_v1.SubscriberClient()
        else:
            subscriber = pubsub_v1.SubscriberClient(credentials=credentials)
        subscription_path = subscriber.subscription_path(project_id, subscription_id)

        subscriber_stream = subscriber.subscribe(subscription_path, callback=callback)
        logger.info(f"🚀 Listening for messages on {subscription_path}...")

        try:
            subscriber_stream.result()
        except Exception as e:
            logger.error(
                f"Listening for messages on {subscription_path} has stopped.",
                exc_info=True
            )
            
            subscriber_stream.cancel()

    except Exception as e:
        logger.error(
            f"Listening for messages on {subscription_path} has stopped.",
            exc_info=True
        )