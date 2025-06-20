import os
import logging
import re
from langchain_community.document_loaders import PDFPlumberLoader
from helper_functions.pdf_summarizer import LLM_summarizer
from helper_functions.vector_embeddings import get_embedding
from helper_functions.weaviate_test import save_to_weaviate, check_file_exists
from app.weaviate_client import setup_weaviate_schema

logger = logging.getLogger(__name__)

def extract_data_from_pdf(file_path: str, data: dict):
    """
    Checks the file type, processes the file, and saves the result to Weaviate.
    """
    try:

        # setup_weaviate_schema() 

        if data.get("fileType","").split('/')[-1] != 'pdf':
            return {
                "message": "Invalid file type. Only PDF files are supported.",
                "exists": False
            }
        loader = PDFPlumberLoader(file_path)
        docs = loader.load()
        text = docs[0].page_content

        data["fileName"] = re.sub(r'\s+', '_', data["fileName"])

        if(check_file_exists(data["fileName"])):
            logger.info(f"Document '{data["fileName"]}' already exists in Weaviate. Skipping saving.")
            return {
                "message": f"Document '{data["fileName"]}' already exists in Weaviate.",
                "created": False
            }

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
            logger.info(f"Saved document '{data["fileName"]}' to Weaviate with UUID: {uuid}")
            return {
                "message": f"Document '{data["fileName"]}' saved to Weaviate with UUID: {uuid}",
                "created": True
            }
        else:
            logger.error(f"Could not generate embedding for {data['fileName']}. Skipping save.")

    except Exception as e:
        logger.error(f"Failed during file processing for Weaviate: {e}", exc_info=True)
        raise
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)
            logger.info(f"Deleted temporary file: {file_path}")