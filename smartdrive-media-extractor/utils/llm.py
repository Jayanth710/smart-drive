import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

model = genai.GenerativeModel("gemini-2.0-flash") 

def LLM_summarizer(text: str):
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