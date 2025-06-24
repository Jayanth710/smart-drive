import os
from langchain_text_splitters import CharacterTextSplitter
from PIL import Image
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

model = genai.GenerativeModel("gemini-2.0-flash") 

def split_text(text, chunk_size=3000, chunk_overlap=200):
    """Split text into chunks of size chunk_size with overlap of chunk_overlap."""
    splitter = CharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    chunks = splitter.split_text(text)
    combined_text = "\n\n".join(chunks)
    return combined_text

def LLM_summarizer(text: str, task: str):
    """Summarize a Image file using Gemini model."""

    combined_text = split_text(text)
    if task == "application":
        prompt = f"""
    Summarize the following document clearly and concisely without missing any important information.
    Organize key points using bullet-style phrasing, but present the summary as a well-structured paragraph.
    Focus only on what is relevant and meaningful in the document.

    --- Begin Document ---
    {combined_text}
    --- End Document ---
    """
    elif task == "image-ocr":
        prompt = f"""
    The following text was extracted from an image using an Optical Character Recognition (OCR) tool. The text may be out of order, contain recognition errors, and lack proper formatting.

Your task is to perform the following steps:
1.  First, mentally reconstruct the text into a clean and coherent document. Correct any obvious OCR spelling errors and organize the content into logical paragraphs.
2.  After you have reconstructed the document, generate a concise, well-written summary of its key information and main topics.

Give the final summary in a well-structured paragraph.

{text}
"""


    response = model.generate_content(prompt)
    embedding = get_embedding(response.text)
    return response.text, embedding

def LLM_caption_generator(image_path: str):
    """Generates a caption for the image using the Gemini model."""

    prompt = f"""
    task is to provide a comprehensive, detailed description of the following image. Describe all key elements, including:

* **Main Subject(s):** Who or what is the main focus? Describe their appearance, clothing, and any actions they are performing.
* **Setting & Background:** Where is the scene taking place? Describe the environment, time of day, and identify any specific landmarks or stores if possible.
* **Composition & Mood:** Describe the overall composition, lighting, and mood of the image (e.g., serene, busy, etc.).
* **Other Details:** Mention any other notable objects, animals, text, or details present in the scene.

Present the final description as a single, well-structured concise paragraph."""

    with Image.open(image_path) as img:
        response = model.generate_content([prompt, img])
    embedding = get_embedding(response.text)
    return response.text, embedding

def get_embedding(text):
    """Generates an embedding for the given text using the Google Generative AI API."""

    response = genai.embed_content(
        model="text-embedding-004",
        content=text,
        task_type="SEMANTIC_SIMILARITY",
        output_dimensionality=768,
    )
    return response['embedding']