import os
from langchain_text_splitters import CharacterTextSplitter
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
    prompt = f"""
    Summarize the following document clearly and concisely without missing any important information.
    Organize key points using bullet-style phrasing, but present the summary as a well-structured paragraph.
    Focus only on what is relevant and meaningful in the document.

    --- Begin Document ---
    {combined_text}
    --- End Document ---
    """


    response = model.generate_content(prompt)
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