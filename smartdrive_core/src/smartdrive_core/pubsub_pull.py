import json
import logging
import os
from google.cloud import pubsub_v1
from google.oauth2 import service_account

logger = logging.getLogger(__name__)

def _get_credentials():
    # Cloud Run: use default credentials (recommended)
    if os.getenv("K_SERVICE"):
        return None
    if not os.getenv("K_SERVICE"):
        from dotenv import load_dotenv
        load_dotenv()

    # Local: prefer GOOGLE_APPLICATION_CREDENTIALS if set
    path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "smartdrive-service-account.json")
    try:
        creds = service_account.Credentials.from_service_account_file(path)
        logger.info(f"Loaded local service account credentials from {path}")
        return creds
    except Exception as e:
        logger.warning(f"Could not load local credentials, using defaults: {e}")
        return None

def pull_and_process(handler, subscription_id: str | None = None):
    """
    Shared pull loop for any subscription.
    handler(data) should do the work and raise on transient failure.
    """
    project_id = os.getenv("GCP_PROJECT_ID", "smartdrive-461502")
    subscription_id = subscription_id or os.getenv("PUBSUB_SUBSCRIPTION_ID")  # <-- SAME KEY for every service
    if not subscription_id:
        raise RuntimeError("PUBSUB_SUBSCRIPTION_ID is not set")

    max_messages = int(os.getenv("MAX_MESSAGES_PER_PULL", "10"))
    ack_extend = int(os.getenv("ACK_DEADLINE_SECONDS", "300"))

    creds = _get_credentials()
    subscriber = pubsub_v1.SubscriberClient(credentials=creds)
    sub_path = subscriber.subscription_path(project_id, subscription_id)

    logger.info(f"Pulling up to {max_messages} messages from {sub_path}")

    resp = subscriber.pull(
        request={"subscription": sub_path, "max_messages": max_messages},
        timeout=30.0,
    )

    if not resp.received_messages:
        logger.info("No messages in queue.")
        return 0

    for rm in resp.received_messages:
        ack_id = rm.ack_id
        msg = rm.message

        # Extend ack deadline upfront if processing may take time
        subscriber.modify_ack_deadline(
            request={"subscription": sub_path, "ack_ids": [ack_id], "ack_deadline_seconds": ack_extend}
        )

        try:
            data = json.loads(msg.data.decode("utf-8"))

            # Validate required fields once (shared contract)
            if "gcsUrl" not in data or "fileName" not in data:
                logger.warning("Missing required fields, acking (discard).")
                subscriber.acknowledge(request={"subscription": sub_path, "ack_ids": [ack_id]})
                continue

            handler(data)  # <-- service-specific work

            subscriber.acknowledge(request={"subscription": sub_path, "ack_ids": [ack_id]})
            logger.info(f"✅ Successfully processed {data['fileName']}")

        except json.JSONDecodeError:
            logger.error("Malformed JSON, acking (discard).")
            subscriber.acknowledge(request={"subscription": sub_path, "ack_ids": [ack_id]})

        except Exception as e:
            logger.error(f"❌ Error processing message: {e}", exc_info=True)
            # IMPORTANT: do NOT ack on transient failure -> nack by setting deadline to 0
            subscriber.modify_ack_deadline(
                request={"subscription": sub_path, "ack_ids": [ack_id], "ack_deadline_seconds": 0}
            )

    return len(resp.received_messages)