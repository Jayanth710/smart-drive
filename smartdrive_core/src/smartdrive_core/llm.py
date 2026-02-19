import json, json_repair
import os
import re
from venv import logger
# from langchain_text_splitters import CharacterTextSplitter
from google import genai
from google.genai import types
from PIL import Image
from dotenv import load_dotenv
from .schema import DOC_SUMMARY_SCHEMA

load_dotenv()

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY", ""))

def LLM_doc_summarizer(text: str):
    """Summarize a file using Gemini model."""

    if not text or not text.strip():
        logger.warning("LLM_doc_summarizer received empty text. Skipping API call.")
        empty_index = {"relevant_dates": [], "entities": [], "document_ids": [], "technical_topics": []}
        return "No content extracted from document.", empty_index, []

    prompt = f"""
    You are an expert Data Analyst.

    Task:
    Analyze the provided content and extract insights strictly according to the JSON schema.

    **Field Guidelines:**
    1. 'executive_overview': A concise 2-5 sentence summary of the main points.
    2. 'key_insights': A list of 3-5 bullet points highlighting
    3. 'index_json':
       - 'relevant_dates': Normalize to YYYY-MM-DD where possible.
       - 'entities': People, Companies, and Key Stakeholders.
       - 'document_ids': Invoice #s, PO #s, or Reference IDs.
       - 'technical_topics': Tech stack, products, or domain jargon.

    --- Begin Content ---
    {text}
    --- End Content ---
    """

    try:
        response = client.models.generate_content(
            model=os.getenv("LLM_MODEL", "gemini-2.5-flash"),
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=4096, 
                response_mime_type="application/json",
                response_schema=DOC_SUMMARY_SCHEMA, 
            ),
        )

        # response = model.generate_content(prompt)
        
        # 3. Parse Response
        # data = json.loads(response.text, strict=False)  # strict=False to allow for minor formatting issues

        # user_summary = data["user_summary_markdown"] 
        # index_json = data["index_json"]
        # overview = data.get("executive_overview", "No overview generated.")
        # insights = data.get("key_insights", [])
        
        # # Assemble with newlines
        # user_summary = overview + "\n\n"
        # if insights:
        #     user_summary += "\n".join([f"- {insight}" for insight in insights])
            
        # index_json = data.get("index_json", {})

        # text_to_embed = f"{user_summary}\n\nKeywords: {json.dumps(index_json)}"
        
        # # Assuming you have a get_embedding function
        # embedding = get_embedding(text_to_embed) 

        # return user_summary, index_json, embedding

        if response.parsed:
            data = response.parsed
        else:
            data = json_repair.loads(response.text)

        overview = data.get("executive_overview", "No overview generated.")
        insights = data.get("key_insights", [])
        user_summary = f"{overview}\n\n" + "\n".join([f"- {i}" for i in insights])
        index_json = data.get("index_json", {})

        # Generate embedding for the result
        embedding = get_embedding(f"{user_summary}\n\nKeywords: {json.dumps(index_json)}") 

        return user_summary, index_json, embedding

    except json.JSONDecodeError as e:
        print(f"JSON Error: {e}")
        # If this happens, it is 99% likely a token limit issue.
        return "Error: Summary truncated.", {}, []
    except Exception as e:
        print(f"General Error: {e}")
        return "Error generating summary.", {}, []

def LLM_media_summarizer(text: str):
    """Summarize a Image file using Gemini model."""

    prompt = f"""The following is a transcript from a dialogue or podcast or from a monologue, speech, or lecture.

Your task is to provide a concise summary that covers:
1.  The main topics that were discussed.
2.  The key points, arguments, or conclusions made by the different speakers.
3.  Any action items or unresolved questions that were mentioned.
4.  The overall conclusion or call to action.

Present the final output as a single, well-structured paragraph and The final output must ONLY be the summary paragraph. Do not refer to speakers as "Speaker 1" unless it's necessary for clarity.

**Transcript:**
{text}
"""


    response = client.models.generate_content(
        model=os.getenv("LLM_MODEL", "gemini-2.5-flash"),
        contents=prompt
    )
    embedding = get_embedding(response.text)
    
    return response.text, embedding

def LLM_image_summarizer(text: str):
    """Summarize a Image file using Gemini model."""

    prompt = f"""
    The following text was extracted from an image using an Optical Character Recognition (OCR) tool and may contain errors or be out of order.

First, mentally reconstruct the text into a clean and coherent document. Then, based on that cleaned-up version, generate a concise summary.

The final output must ONLY be the summary paragraph. Do not include the reconstructed text or any other preamble.

**Raw OCR Text:**
{text}
"""


    response = client.models.generate_content(
        model=os.getenv("LLM_MODEL", "gemini-2.5-flash"),
        contents=prompt
    )
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
        response = client.models.generate_content(
            model=os.getenv("LLM_MODEL", "gemini-2.5-flash"),
            contents=[prompt, img]
        )
    embedding = get_embedding(response.text)
    
    return response.text, embedding

def get_embedding(text):
    """Generates an embedding for the given text using the Google Generative AI API."""
    try:
        result = client.models.embed_content(
            model="gemini-embedding-001", # Newest standard embedding model
            contents=text,
            config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
            output_dimensionality=768
        )
        return result.embeddings[0].values
    except Exception as e:
        # Log the error properly so you don't crash hard
        print(f"Error generating embedding: {e}")
        # Return a zero-vector or None to prevent downstream crashes
        return [0.0] * 768