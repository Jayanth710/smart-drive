import logging
from .pdf import extract_data_from_pdf
from app.weaviate_client import setup_weaviate_schema


logger = logging.getLogger(__name__)

def file_extractor(output_path: str, data: dict):
    """Redirect the data from the file based on the application typeand writes it to a weaviate."""
    
    setup_weaviate_schema()

    file_type = data.get("fileType").split('/')[-1]

    match file_type:
        case "pdf":
            logger.info("Extracting PDF data...")
            res = extract_data_from_pdf(output_path, data)
            if(not res.get("created")):
                return {
                    "message": res.get("message"),
                    "created": False
                }
            else:
                return {
                    "message": res.get("message"),
                    "created": True,
                }

