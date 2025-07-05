import json
import logging
import os
from google.cloud import pubsub_v1
from google.oauth2 import service_account
from utils.gcs_file_download import download_from_gcs
from google.api_core.exceptions import NotFound

logger = logging.getLogger(__name__)

PROJECT_ID = os.getenv("GCP_PROJECT_ID", "smartdrive-461502")
SUBSCRIPTION_ID = os.getenv("PUBSUB_SUBSCRIPTION_ID", "smartdrive-image-extract-sub")
MAX_MESSAGES_PER_PULL = 10
credentials = None

if not os.getenv('K_SERVICE'):
    try:
        credentials = service_account.Credentials.from_service_account_file(
            "smartdrive-service-account.json"
        )
        logger.info("Loaded local service account credentials.")
    except Exception as e:
        logger.warning(f"Could not load local credentials, using defaults: {e}")

def pubsub():
    """
    Pulls a batch of messages from a Pub/Sub subscription, processes them,
    and then exits. This is ideal for a scheduled task.
    """
    subscriber = pubsub_v1.SubscriberClient(credentials=credentials)
    subscription_path = subscriber.subscription_path(PROJECT_ID, SUBSCRIPTION_ID)
    
    logger.info(f"Pulling up to {MAX_MESSAGES_PER_PULL} messages from {subscription_path}...")

    try:

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
                data = json.loads(received_message.message.data.decode("utf-8"))
                
                if "gcsUrl" not in data or "fileName" not in data:
                    logger.error("Message is missing 'gcsUrl' or 'fileName'. Discarding.")
                    ack_ids.append(received_message.ack_id)
                    continue

                logger.info(f"Processing message for file: {data['fileName']}")
                download_from_gcs(data)

                ack_ids.append(received_message.ack_id)
                logger.info(f"Successfully processed {data['fileName']}.")

            except NotFound:
                logger.error(f"File '{data.get('fileName')}' not found in GCS. Discarding message.")
            except json.JSONDecodeError:
                logger.error("Failed to decode message data. Discarding message.")
            except Exception as e:
                logger.error(f"❌ Unhandled error processing message for {data.get('fileName')}: {e}", exc_info=True)
            finally:
                ack_ids.append(received_message.ack_id)

        if ack_ids:
            subscriber.acknowledge(
                request={"subscription": subscription_path, "ack_ids": ack_ids}
            )
            logger.info(f"Acknowledged {len(ack_ids)} messages.")

    except Exception as e:
        logger.error(f"An error occurred during the pull-and-process cycle: {e}", exc_info=True)