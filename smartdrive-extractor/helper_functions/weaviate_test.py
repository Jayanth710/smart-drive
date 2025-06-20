import logging
from dotenv import load_dotenv
from app.weaviate_client import get_weaviate_client
from weaviate.classes.query import Filter
load_dotenv()

logger = logging.getLogger(__name__)

COLLECTION_NAME = "SmartDriveSummary"

client = get_weaviate_client()
summaries = client.collections.get(COLLECTION_NAME)

def check_file_exists(file_name: str):
    """
    Checks if a file exists in the specified directory.
    """

    try:
        res = summaries.query.bm25(
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


def save_to_weaviate(data_to_save: dict, vector: list[float]):
    """
    Saves a document's metadata and its vector embedding to Weaviate.
    """

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
    
    # logger.info(f"Successfully saved document '{properties['fileName']}' to Weaviate with UUID: {uuid}.")
    return uuid