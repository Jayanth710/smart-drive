import json
import weaviate.classes as wvc
import logging
from app.weaviate_client import get_weaviate_client
from dotenv import load_dotenv
load_dotenv()

logger = logging.getLogger(__name__)

COLLECTION_NAME = "SmartDriveDocuments"

try:
    client = get_weaviate_client()
    summaries_collection = client.collections.get(COLLECTION_NAME)
    logger.info(f"Succesfully Connected to Weaviate.")
except Exception as e:
    logger.info(f"Error connecting to Weaviate. {e}")
    raise


def setup_weaviate_schema():
    """
    Creates the 'SmartDriveSummary' collection in Weaviate if it doesn't exist.
    This defines the structure of your data.
    """
    if client.collections.exists(COLLECTION_NAME):
        logger.info(f"Collection '{COLLECTION_NAME}' already exists.")
        return
    # if client.collections.exists(COLLECTION_NAME):
    #     logger.warning(f"Collection '{COLLECTION_NAME}' exists. Deleting to apply new schema with named vector.")
    #     client.collections.delete(COLLECTION_NAME)

    logger.info(f"Creating collection '{COLLECTION_NAME}'...")
    
    try:
        # Define the schema for your data
        client.collections.create(
            name=COLLECTION_NAME,
            properties=[
                wvc.config.Property(
                name="file_id",
                data_type=wvc.config.DataType.TEXT,
                description="The _id from the MongoDB 'files' collection",
            ),
            wvc.config.Property(
                name="user_id",
                data_type=wvc.config.DataType.TEXT,
                description="The ID of the user who owns the file",
            ),

            wvc.config.Property(
                name="summary",
                data_type=wvc.config.DataType.TEXT,
                description="A chunk of text extracted from the document"
            ),
            wvc.config.Property(
                name="filename",
                data_type=wvc.config.DataType.TEXT,
                description="The original user-facing filename for display",
            ),
            wvc.config.Property(
                name="filetype",
                data_type=wvc.config.DataType.TEXT,
                description="The original file type",
            ),
            wvc.config.Property(
                name="created_at",
                data_type=wvc.config.DataType.DATE,
                description="The timestamp of when the file was uploaded",
                index_filterable=True
            ),
            wvc.config.Property(
                name="index_json",
                data_type=wvc.config.DataType.TEXT, 
                description="Raw JSON blob of metadata",
            ),
            ],
            vectorizer_config=wvc.config.Configure.Vectorizer.none(),
        )
        logger.info("Schema created successfully.")
    except Exception as e:
        logger.error(f"Error creating schema: {e}")
        raise e

def check_file_exists(file_id: str, user_id: str):
    """
    Checks if any chunks for a given file and user already exist in Weaviate.
    This query is filtered by both mongoFileId and userId for security and correctness.
    """

    try:
        filters = wvc.Filter.all_of([
            wvc.Filter.by_property("file_id").equal(file_id),
            wvc.Filter.by_property("user_id").equal(user_id)
        ])

        response = summaries_collection.query.fetch_objects(
            limit=1,
            filters=filters
        )

        if response and response.objects:
            file_exists = len(response.objects) > 0
            if file_exists:
                logger.info(f"File with FileId '{file_id}' already indexed for userId '{user_id}'.")
            
            return file_exists
        else:
            logger.info(f"File with FileId '{file_id}' not found in Weaviate for userId '{user_id}'.")
            return False
    
    except:
        logger.error(f"Error while checking if '{file_id}' exists in Weaviate. Skipping saving.")
        return None


def upload_to_weaviate(data: dict, user_summary: str, index_json: json, embedding: list) -> dict:
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

        properties_to_save = {
            "filename": data.get("fileName"),
            "file_id": str(data.get("_id")),
            "user_id": data.get("userId"),
            "summary": user_summary,
            "index_json": index_json,
            "filetype": data.get("fileType"),
            "created_at": data.get("uploadedAt")
        }

        uuid = summaries_collection.data.insert(
            properties=properties_to_save,
            vector={
                "default": embedding
            }
        )
        
        # logger.info(f"Successfully saved document '{data.get("fileName")}' to Weaviate with UUID: {uuid}.")
        logger.info(f"Successfully saved document '{data.get('fileName')}' to Weaviate with UUID: {uuid}.")


        # client.close()
        
        return {
            "message": f"Document {data.get('fileName')} saved to Weaviate with UUID: {uuid}",
            "created": True,
            "uuid": str(uuid)
        }

    except Exception as e:
        logger.error(f"Failed during Weaviate save process: {e}", exc_info=True)
        raise