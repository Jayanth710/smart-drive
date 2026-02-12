import os
from PIL import Image
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

model = genai.GenerativeModel(os.getenv("LLM_MODEL", "gemini-2.5-flash")) 

def LLM_summarizer(text: str):
    """Summarize a Image file using Gemini model."""

    prompt = f"""
    The following text was extracted from an image using an Optical Character Recognition (OCR) tool and may contain errors or be out of order.

First, mentally reconstruct the text into a clean and coherent document. Then, based on that cleaned-up version, generate a concise summary.

The final output must ONLY be the summary paragraph. Do not include the reconstructed text or any other preamble.

**Raw OCR Text:**
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