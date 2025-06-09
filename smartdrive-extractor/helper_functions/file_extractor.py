import os
from helper_functions.pdf_summarizer import LLM_summarizer
from langchain_community.document_loaders import PDFPlumberLoader
from pymongo.mongo_client import MongoClient

client = MongoClient(os.getenv("MONGODB_URI"))
db = client["SmartDrive-data"]
collection = db["summaries"]

def extract_data_from_pdf(file_path):
    """Extract data from a PDF file."""
    loader = PDFPlumberLoader(file_path)
    docs = loader.load()
    metadata = docs[0].metadata
    text = docs[0].page_content

    summary = LLM_summarizer(text)
    data_extracted = {
        "FileName": os.path.basename(file_path),
        "Author": metadata.get("Author","Unknown"),
        "CreatedAt": metadata.get("CreationDate","Unknown"),
        "ModifiedAt": metadata.get("ModDate", "Unknown"),
        "Summary": summary
    }
    try:
        exist = collection.find_one({"FileName": data_extracted["FileName"]})
        if exist:
            print(f"File already exists: {data_extracted['FileName']}")
            if os.path.exists(file_path):
                os.remove(file_path)
            return
        collection.insert_one(data_extracted)
        print(f"Data inserted successfully: {data_extracted['FileName']}")
        if os.path.exists(file_path):
            os.remove(file_path)
            print(f"Deleted temporary file: {file_path}")
        else:
            print(f"File not found: {file_path}")
    except Exception as e:
        print(f"Error inserting data: {e}")
