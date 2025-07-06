import json
import logging
import os
from google.cloud import pubsub_v1
from google.oauth2 import service_account
from utils.gcs_file_download import download_from_gcs
from google.api_core.exceptions import NotFound

logger = logging.getLogger(__name__)

PROJECT_ID = os.getenv("GCP_PROJECT_ID", "smartdrive-461502")
SUBSCRIPTION_ID = os.getenv("PUBSUB_DATA_SUBSCRIPTION_ID", "smartdrive-data-extract-sub")
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

        for received_message in response.received_messages:
            ack_id = received_message.ack_id
            try:
                data = json.loads(received_message.message.data.decode("utf-8"))

                if "gcsUrl" not in data or "fileName" not in data:
                    logger.warning("Missing required fields, discarding this message.")
                    subscriber.acknowledge(
                        request={"subscription": subscription_path, "ack_ids": [ack_id]}
                    )
                    continue

                download_from_gcs(data)

                logger.info(f"✅ Successfully processed {data['fileName']}")
                subscriber.acknowledge(
                    request={"subscription": subscription_path, "ack_ids": [ack_id]}
                )

            except json.JSONDecodeError:
                logger.error("Malformed JSON — will discard message.")
                subscriber.acknowledge(
                    request={"subscription": subscription_path, "ack_ids": [ack_id]}
                )
            except Exception as e:
                logger.error(f"❌ Fatal error processing {data.get('fileName', 'unknown')}: {e}", exc_info=True)
                subscriber.acknowledge(
                    request={"subscription": subscription_path, "ack_ids": [ack_id]}
                )

    except Exception as e:
        logger.error(f"An error occurred during the pull-and-process cycle: {e}", exc_info=True)