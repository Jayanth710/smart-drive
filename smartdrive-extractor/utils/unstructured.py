import logging
from unstructured.partition.auto import partition
from unstructured.documents.elements import Title, NarrativeText, Table, Image, ListItem

logger = logging.getLogger(__name__)
def extract_from_file(file_path: str):
    """Parses a document using the 'unstructured' library and send to LLM."""

    logger.info(f"Extracting text...")

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
                chunks.append(f"![{element.text}]({element.url})\n")
            elif isinstance(element, ListItem):
                chunks.append(f"- {element.text}\n")
            else:
                chunks.append(f"{element.text}\n")

        cleaned_text = "\n".join(chunks)
        logger.info(f"Extracted text: {cleaned_text[:50]}...")
        return cleaned_text
    
    except Exception as e:
        logger.error(f"Error during extraction: {e}")
        return ""