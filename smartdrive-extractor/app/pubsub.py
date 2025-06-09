import json
import logging
import os
from google.cloud import pubsub_v1
from google.oauth2 import service_account
from utils.gcs_file_download import download_from_gcs

logger = logging.getLogger(__name__)

project_id = "smartdrive-461502"
subscription_id = "smartdrive-data-extract-sub"

isLocal = os.getenv("NODE_ENV")
if(isLocal=='dev'):
    credentials = service_account.Credentials.from_service_account_file(
    "smartdrive-service-account.json")
else:
    credentials = None
    


# Define the callback that handles incoming messages
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
        output_path = download_from_gcs(data["fileUrl"], data["fileName"])
        logger.info(f"Successfully processed and downloaded file to {output_path}")
        
        message.ack()
    except json.JSONDecodeError as e:
        logger.error(f"Failed to decode message data: {e}")
        message.nack()
    except Exception as e:
        logger.error(f"❌ Error processing message: {e}", exc_info=True)
        message.nack()

def pubsub():
    """Starts the Pub/Sub subscriber and blocks until an error occurs."""
    # The client is initialized without any credentials parameter.
    subscriber = pubsub_v1.SubscriberClient(credentials=credentials)
    subscription_path = subscriber.subscription_path(project_id, subscription_id)

    streaming_pull_future = subscriber.subscribe(subscription_path, callback=callback)
    logger.info(f"🚀 Listening for messages on {subscription_path}...")

    try:
        streaming_pull_future.result()
    except Exception as e:
        logger.error(
            f"Listening for messages on {subscription_path} has stopped.",
            exc_info=True
        )

        streaming_pull_future.cancel()