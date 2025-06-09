# import os
# import json
# from google.cloud import pubsub_v1
# from utils.gcs_file_download import download_from_gcs;

# # Point to your service account key
# # os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "smartdrive-service-account.json"

# project_id = "smartdrive-461502"
# subscription_id = "smartdrive-data-extract-sub"
# # Set up subscriber
# from google.oauth2 import service_account

# # Load credentials from the local JSON file
# credentials = service_account.Credentials.from_service_account_file(
#     "smartdrive-service-account.json"
# )

# # Define the callback that handles incoming messages
# def callback(message):
#     try:
#         data = json.loads(message.data.decode("utf-8"))
#         # data = json.dumps(data, indent=2)
#         output_path = download_from_gcs(data["fileUrl"], data["fileName"])
#         message.ack()
#     except Exception as e:
#         print("❌ Error processing message:", e)
#         message.nack()

# def pubsub():
#     subscriber = pubsub_v1.SubscriberClient(credentials=credentials)
#     subscription_path = subscriber.subscription_path(project_id, subscription_id)

#     # Start listening
#     subscriber.subscribe(subscription_path, callback=callback)
#     print(f"🚀 Listening to {subscription_path}")

#     # Keep the process alive
#     import time
#     while True:
#         time.sleep(60)

import os
import json
import logging
from google.cloud import pubsub_v1
from google.oauth2 import service_account
from utils.gcs_file_download import download_from_gcs

# --- Best Practice Logging ---
# It's better to get the logger this way so the name is consistent.
logger = logging.getLogger(__name__)

# --- No more manual credential loading! ---
# The SubscriberClient will automatically use the service account
# credentials provided by the Cloud Run environment.

project_id = "smartdrive-461502"
subscription_id = "smartdrive-data-extract-sub"

credentials = service_account.Credentials.from_service_account_file(
    "smartdrive-service-account.json"
)


# Define the callback that handles incoming messages
def callback(message: pubsub_v1.subscriber.message.Message) -> None:
    """Processes a single Pub/Sub message."""
    try:
        logger.info(f"Received message with ID: {message.message_id}")
        data = json.loads(message.data.decode("utf-8"))
        
        # Ensure the message has the data we expect
        if "fileUrl" not in data or "fileName" not in data:
            logger.error("Message is missing 'fileUrl' or 'fileName'.")
            message.nack() # Negative acknowledgement
            return

        logger.info(f"Downloading {data['fileName']} from {data['fileUrl']}")
        output_path = download_from_gcs(data["fileUrl"], data["fileName"])
        logger.info(f"Successfully processed and downloaded file to {output_path}")
        
        message.ack() # Acknowledge the message
    except json.JSONDecodeError as e:
        logger.error(f"Failed to decode message data: {e}")
        message.nack()
    except Exception as e:
        # This will catch errors from download_from_gcs or other issues
        logger.error(f"❌ Error processing message: {e}", exc_info=True)
        message.nack()

def pubsub():
    """Starts the Pub/Sub subscriber and blocks until an error occurs."""
    # The client is initialized without any credentials parameter.
    subscriber = pubsub_v1.SubscriberClient(credentials=credentials)
    subscription_path = subscriber.subscription_path(project_id, subscription_id)

    # The subscriber.subscribe() call is non-blocking. It starts a background
    # thread that polls for messages and calls your callback.
    streaming_pull_future = subscriber.subscribe(subscription_path, callback=callback)
    logger.info(f"🚀 Listening for messages on {subscription_path}...")

    # The future.result() method will block indefinitely until the
    # subscription is cancelled or encounters a fatal error. This is the
    # correct way to keep your listener thread alive.
    try:
        streaming_pull_future.result()
    except Exception as e:
        logger.error(
            f"Listening for messages on {subscription_path} has stopped.",
            exc_info=True
        )
        # You might want to add logic here to handle the subscriber stopping.
        # For now, we just log the error.
        streaming_pull_future.cancel()