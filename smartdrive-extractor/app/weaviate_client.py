import os
import weaviate
import logging
from dotenv import load_dotenv
load_dotenv()

logger = logging.getLogger(__name__)

WEAVIATE_URL = os.getenv("WEAVIATE_URL")
WEAVIATE_API_KEY = os.getenv("WEAVIATE_API_KEY")

client = None

def get_weaviate_client():
    """Initializes and returns the Weaviate client."""
    global client
    if client and client.is_live():
        return client

    if not WEAVIATE_URL or not WEAVIATE_API_KEY:
        logger.error("WEAVIATE_CLUSTER_URL or WEAVIATE_API_KEY environment variables not set.")
        raise ValueError("Weaviate environment variables are not configured.")

    try:
        client = weaviate.connect_to_weaviate_cloud(
            cluster_url=WEAVIATE_URL,
            auth_credentials=weaviate.auth.AuthApiKey(WEAVIATE_API_KEY),
        )
        logger.info("Successfully connected to Weaviate.")
        return client
    except Exception as e:
        logger.error(f"Failed to connect to Weaviate: {e}", exc_info=True)
        raise