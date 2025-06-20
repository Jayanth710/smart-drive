import os
import weaviate
import weaviate.classes as wvc
import logging
from dotenv import load_dotenv
load_dotenv()

logger = logging.getLogger(__name__)

WEAVIATE_URL = os.getenv("WEAVIATE_URL")
WEAVIATE_API_KEY = os.getenv("WEAVIATE_API_KEY")
COLLECTION_NAME = "SmartDriveSummary"

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

def setup_weaviate_schema():
    """
    Creates the 'SmartDriveSummary' collection in Weaviate if it doesn't exist.
    This defines the structure of your data.
    """
    client = get_weaviate_client()
    collections = client.collections.list_all()
    
    if COLLECTION_NAME in collections:
        logger.info(f"Collection '{COLLECTION_NAME}' already exists.")
        return
    # if client.collections.exists(COLLECTION_NAME):
    #     logger.warning(f"Collection '{COLLECTION_NAME}' exists. Deleting to apply new schema with named vector.")
    #     client.collections.delete(COLLECTION_NAME)

    logger.info(f"Creating collection '{COLLECTION_NAME}'...")
    
    # Define the schema for your data
    client.collections.create(
        name=COLLECTION_NAME,
        properties=[
            wvc.config.Property(name="fileName", data_type=wvc.config.DataType.TEXT),
            wvc.config.Property(name="fileType", data_type=wvc.config.DataType.TEXT),
            wvc.config.Property(name="summary", data_type=wvc.config.DataType.TEXT),
            wvc.config.Property(name="uploadedAt", data_type=wvc.config.DataType.DATE, index_filterable=True),
        ],
        vectorizer_config=wvc.config.Configure.Vectorizer.none(),
    )
    logger.info("Schema created successfully.")