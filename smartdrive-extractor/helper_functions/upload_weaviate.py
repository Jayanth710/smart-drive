import logging
from helper_functions.llm_summarizer import LLM_summarizer
from helper_functions.vector_embeddings import get_embedding
from helper_functions.weaviate_test import save_to_weaviate

logger = logging.getLogger(__name__)

def upload_to_weaviate(text: str, data: dict):
    """Uploads a file information to Weaviate."""

    try:
        filename = data.get("fileName")

        summary = LLM_summarizer(text)
        embedding = get_embedding(summary)

        data_to_save = {
            "FileName": data["fileName"],
            "FileType": data["fileType"],
            "UploadedAt": data["uploadedAt"],
            "Summary": summary,
        }

        if embedding:
            uuid = save_to_weaviate(data_to_save, embedding)
            return {
                "message": f"Document {filename} saved to Weaviate with UUID: {uuid}",
                "created": True
            }
        else:
            logger.error(f"Could not generate embedding for {filename}. Skipping save.")

    except Exception as e:
        logger.error(f"Failed during file processing for Weaviate: {e}", exc_info=True)
        raise