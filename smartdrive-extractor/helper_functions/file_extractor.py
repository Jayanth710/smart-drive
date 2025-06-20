import os
import logging
import re
from langchain_community.document_loaders import PDFPlumberLoader
from helper_functions.pdf_summarizer import LLM_summarizer
from helper_functions.vector_embeddings import get_embedding
from helper_functions.weaviate_test import save_to_weaviate
from app.weaviate_client import setup_weaviate_schema

logger = logging.getLogger(__name__)

def extract_data_from_pdf(file_path: str, data: dict):
    """
    Checks the file type, processes the file, and saves the result to Weaviate.
    """
    try:

        setup_weaviate_schema() 

        if data.get("fileType","").split('/')[-1] != 'pdf':
            print("Not PDF file. Skipping.")
            return
        loader = PDFPlumberLoader(file_path)
        docs = loader.load()
        text = docs[0].page_content

        data["fileName"] = re.sub(r'\s+', '_', data["fileName"])

        summary = LLM_summarizer(text)
        embedding = get_embedding(summary)
        data_to_save = {
            "FileName": data["fileName"],
            "FileType": data["fileType"],
            "UploadedAt": data["uploadedAt"],
            "Summary": summary,
        }

        if embedding:
            save_to_weaviate(data_to_save, embedding)
        else:
            logger.error(f"Could not generate embedding for {data['fileName']}. Skipping save.")

    except Exception as e:
        logger.error(f"Failed during file processing for Weaviate: {e}", exc_info=True)
        raise
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)
            logger.info(f"Deleted temporary file: {file_path}")