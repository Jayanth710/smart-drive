import logging
from unstructured.partition.auto import partition
from unstructured.documents.elements import Title, NarrativeText, Table, Image, ListItem

logger = logging.getLogger(__name__)

def extract_from_file(file_path: str) -> str:
    """
    Parses a document using the 'unstructured' library and returns cleaned markdown-like text.
    Supports PDFs, DOCX, PPTX, XLSX, etc.
    """

    logger.info(f"📄 Extracting text from: {file_path}")

    try:
        elements = partition(filename=file_path)
        chunks = []

        for element in elements:
            if isinstance(element, Title):
                chunks.append(f"# {element.text}\n")
            elif isinstance(element, NarrativeText):
                chunks.append(f"{element.text}\n")
            elif isinstance(element, Table):
                chunks.append(f"### {element.text}\n")
            elif isinstance(element, Image):
                chunks.append(f"![{element.text}]({getattr(element, 'url', '')})\n")
            elif isinstance(element, ListItem):
                chunks.append(f"- {element.text}\n")
            else:
                chunks.append(f"{element.text}\n")

        cleaned_text = "\n".join(chunk.strip() for chunk in chunks if chunk.strip())

        if cleaned_text:
            logger.info(f"✅ Extracted text (preview): {cleaned_text[:50]}...")
        else:
            logger.warning("⚠️ No text was extracted from the file.")

        return cleaned_text

    except Exception as e:
        logger.exception(f"❌ Error during file extraction: {e}")
        return ""