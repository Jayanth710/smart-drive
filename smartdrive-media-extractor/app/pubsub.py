# import json
# import logging
# import os
# from google.cloud import pubsub_v1
# from google.oauth2 import service_account
# from utils.gcs_file_download import download_from_gcs
# from google.api_core.exceptions import NotFound

# logger = logging.getLogger(__name__)

# PROJECT_ID = "smartdrive-461502"
# SUBSCRIPTION_ID = "smartdrive-media-extract-sub"
# ACK_DEADLINE_SECONDS = 600

# credentials = None

# if not os.getenv('K_SERVICE'):
#     try:
#         credentials = service_account.Credentials.from_service_account_file(
#             "smartdrive-service-account.json"
#         )
#         logger.info("GCS Downloader: Loaded local service account credentials.")
#     except Exception as e:
#         logger.warning(f"GCS Downloader: Could not load local credentials, using defaults: {e}")
    
# def callback(message: pubsub_v1.subscriber.message.Message) -> None:
#     """Processes a single Pub/Sub message."""

#     try:
#         message.modify_ack_deadline(ACK_DEADLINE_SECONDS)
#         logger.info(f"Extended ack deadline for message {message.message_id} to {ACK_DEADLINE_SECONDS} seconds.")
#     except Exception as e:
#         logger.error(f"Failed to modify ack deadline: {e}")
#         message.nack()
#         return
    
#     try:
#         logger.info(f"Received message with ID: {message.message_id}")
#         data = json.loads(message.data.decode("utf-8"))
        
#         if "gcsUrl" not in data or "fileName" not in data:
#             logger.error("Message is missing 'fileUrl' or 'fileName'.")
#             message.nack()
#             return

#         logger.info(f"Downloading {data['fileName']} from GCS...")

#         response = download_from_gcs(data)
#         if(response.get("url") is None):
#             logger.info(response.get("message"))
#         else:
#             logger.info(f"{response.get('message')} and URL: {response.get('url')}")
        
#         message.ack()
            
#     except NotFound:
#         logger.error(f"File '{data.get('fileName')}' not found. Acking message to break loop.")
#         message.ack() 
#     except json.JSONDecodeError as e:
#         logger.error(f"Failed to decode message data: {e}")
#         message.nack()
#     except Exception as e:
#         logger.error(f"❌ Error processing message: {e}", exc_info=True)
#         message.nack()

# def pubsub():
#     """Starts the Pub/Sub subscriber and blocks until an error occurs."""
#     try:
#         if(credentials is None):
#             subscriber = pubsub_v1.SubscriberClient()
#         else:
#             subscriber = pubsub_v1.SubscriberClient(credentials=credentials)
#         subscription_path = subscriber.subscription_path(PROJECT_ID, SUBSCRIPTION_ID)

#         subscriber_stream = subscriber.subscribe(subscription_path, callback=callback)
#         logger.info(f"🚀 Listening for messages on {subscription_path}...")

#         try:
#             subscriber_stream.result()
#         except Exception as e:
#             logger.error(
#                 f"Listening for messages on {subscription_path} has stopped.",
#                 exc_info=True
#             )
            
#             subscriber_stream.cancel()

#     except Exception as e:
#         logger.error(
#             f"Listening for messages on {subscription_path} has stopped.",
#             exc_info=True
#         )

import json
import logging
import os
from google.cloud import pubsub_v1
from google.oauth2 import service_account
from utils.gcs_file_download import download_from_gcs
from google.api_core.exceptions import NotFound

logger = logging.getLogger(__name__)

# --- Configuration ---
# These can be set as environment variables in your Cloud Run service
PROJECT_ID = os.getenv("GCP_PROJECT_ID", "smartdrive-461502")
SUBSCRIPTION_ID = os.getenv("PUBSUB_SUBSCRIPTION_ID", "smartdrive-media-extract-sub")
MAX_MESSAGES_PER_PULL = 10 # Process up to 10 messages per run

# --- Credentials for Local Development ---
credentials = None
# This checks if the code is running in a deployed Cloud Run environment
if not os.getenv('K_SERVICE'):
    try:
        credentials = service_account.Credentials.from_service_account_file(
            "smartdrive-service-account.json"
        )
        logger.info("Loaded local service account credentials.")
    except Exception as e:
        logger.warning(f"Could not load local credentials, using defaults: {e}")

# --- Main Function (The New Pull Logic) ---
def pubsub():
    """
    Pulls a batch of messages from a Pub/Sub subscription, processes them,
    and then exits. This is ideal for a scheduled task.
    """
    subscriber = pubsub_v1.SubscriberClient(credentials=credentials)
    subscription_path = subscriber.subscription_path(PROJECT_ID, SUBSCRIPTION_ID)
    
    logger.info(f"Pulling up to {MAX_MESSAGES_PER_PULL} messages from {subscription_path}...")

    try:
        # 1. Pull a batch of messages. This is a synchronous, non-blocking call.
        response = subscriber.pull(
            request={"subscription": subscription_path, "max_messages": MAX_MESSAGES_PER_PULL},
            timeout=30.0,
        )

        if not response.received_messages:
            logger.info("No messages in queue. Exiting.")
            return

        ack_ids = []
        for received_message in response.received_messages:
            data = {}
            try:
                # 2. Process each message individually
                data = json.loads(received_message.message.data.decode("utf-8"))
                
                if "gcsUrl" not in data or "fileName" not in data:
                    logger.error("Message is missing 'gcsUrl' or 'fileName'. Discarding.")
                    ack_ids.append(received_message.ack_id) # Ack to remove bad message
                    continue

                logger.info(f"Processing message for file: {data['fileName']}")
                download_from_gcs(data) # This function now needs to handle its own errors or raise them

                # 3. If processing succeeds, add the message to the list to be acknowledged
                ack_ids.append(received_message.ack_id)
                logger.info(f"Successfully processed {data['fileName']}.")

            except NotFound:
                logger.error(f"File '{data.get('fileName')}' not found in GCS. Discarding message.")
                ack_ids.append(received_message.ack_id) # Ack to remove this "poison pill" message
            except json.JSONDecodeError:
                logger.error("Failed to decode message data. Discarding message.")
                ack_ids.append(received_message.ack_id) # Ack to remove malformed message
            except Exception as e:
                # For any other unexpected error, we do NOT ack the message.
                # It will become available again after its visibility timeout for a future run.
                logger.error(f"❌ Unhandled error processing message for {data.get('fileName')}: {e}", exc_info=True)

        # 4. Acknowledge all successfully processed (or discarded) messages in one batch
        if ack_ids:
            subscriber.acknowledge(
                request={"subscription": subscription_path, "ack_ids": ack_ids}
            )
            logger.info(f"Acknowledged {len(ack_ids)} messages.")

    except Exception as e:
        logger.error(f"An error occurred during the pull-and-process cycle: {e}", exc_info=True)