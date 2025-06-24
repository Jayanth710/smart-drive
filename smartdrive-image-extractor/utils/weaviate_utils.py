import weaviate.classes as wvc
from weaviate.classes.query import Filter
import logging
from app.weaviate_client import get_weaviate_client
from dotenv import load_dotenv
load_dotenv()

logger = logging.getLogger(__name__)

COLLECTION_NAME = "SmartDriveSummary"

client = get_weaviate_client()
summaries_collection = client.collections.get(COLLECTION_NAME)


def setup_weaviate_schema():
    """
    Creates the 'SmartDriveSummary' collection in Weaviate if it doesn't exist.
    This defines the structure of your data.
    """
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

def check_file_exists(file_name: str):
    """
    Checks if a file exists in the specified directory.
    """

    try:
        res = summaries_collection.query.bm25(
        query=file_name,
        filters=Filter.by_property("fileName").equal(file_name),
        limit=1
        )
    
        if(res.objects):
            fileName = res.objects[0].properties.get("fileName")
            if(fileName == file_name):
                return True
        return False
    
    except:
        logger.error(f"Error while checking if '{file_name}' exists in Weaviate. Skipping saving.")
        return None


def upload_to_weaviate(data: dict, summary: str, embedding: list) -> dict:
    """
    Generates a summary and embedding from text, then saves the complete
    record (metadata and vector) to Weaviate in a single, robust function.

    Args:
        text_to_process: The raw text extracted from a document.
        original_message_data: The original data dictionary from the Pub/Sub message.

    Returns:
        A dictionary indicating the result of the operation.
    """
    try:
        file_name = data.get("fileName")
        if not file_name:
            raise ValueError("fileName not found in message data.")

        logger.info(f"Generating summary and embedding for '{file_name}'...")

        if not embedding:
            logger.error(f"Could not generate embedding for {file_name}. Aborting save.")
            return {
                "message": f"Could not generate embedding for {file_name}. Aborting save.",
                "created": False,
            }

        properties_to_save = {
            "fileName": file_name,
            "fileType": data.get("fileType"),
            "summary": summary,
            "uploadedAt": data.get("uploadedAt"),
        }

        uuid = summaries_collection.data.insert(
            properties=properties_to_save,
            vector={
                "default": embedding
            }
        )
        
        logger.info(f"Successfully saved document '{file_name}' to Weaviate with UUID: {uuid}.")

        client.close()
        
        return {
            "message": f"Document {file_name} saved to Weaviate with UUID: {uuid}",
            "created": True,
            "uuid": str(uuid)
        }

    except Exception as e:
        logger.error(f"Failed during Weaviate save process: {e}", exc_info=True)
        raise