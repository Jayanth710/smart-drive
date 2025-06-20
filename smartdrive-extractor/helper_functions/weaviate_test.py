import logging
from dotenv import load_dotenv
from app.weaviate_client import get_weaviate_client
load_dotenv()

logger = logging.getLogger(__name__)

COLLECTION_NAME = "SmartDriveSummary"

def save_to_weaviate(data_to_save: dict, vector: list[float]):
    """
    Saves a document's metadata and its vector embedding to Weaviate.
    """
    client = get_weaviate_client()
    summaries = client.collections.get(COLLECTION_NAME)

    # Prepare the data object for Weaviate
    properties = {
        "fileName": data_to_save.get("FileName"),
        "fileType": data_to_save.get("FileType"),
        "summary": data_to_save.get("Summary"),
        "uploadedAt": data_to_save.get("UploadedAt"),
    }

    # Insert the data object along with its vector
    uuid = summaries.data.insert(
        properties=properties,
        vector={
            "default": vector
        }
    )
    
    logger.info(f"Successfully saved document '{properties['fileName']}' to Weaviate with UUID: {uuid}.")
    return uuid