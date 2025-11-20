import json
import os
import re
from venv import logger
from langchain_text_splitters import CharacterTextSplitter
import google.generativeai as genai
from dotenv import load_dotenv
from schema import DOC_SUMMARY_SCHEMA

load_dotenv()

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# model = genai.GenerativeModel("gemini-2.0-flash") 

def split_text(text, chunk_size=3000, chunk_overlap=200):
    """Split text into chunks of size chunk_size with overlap of chunk_overlap."""
    splitter = CharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    chunks = splitter.split_text(text)
    combined_text = "\n\n".join(chunks)
    return combined_text

def LLM_summarizer(text: str):
    """Summarize a file using Gemini model."""

    # combined_text = split_text(text)
    # prompt = f"""
    #     You are an expert Data Analyst. Analyze the following file content.

    #     --- Begin File Content ---
    #     {text}
    #     --- End File Content ---

    #     **Instructions:**
    #     Determine if this file is a narrative document (PDF, DOCX) or a structured dataset (CSV, XLSX). Adapt your analysis to match the file type.

    #     **Structure your response exactly like this:**

    #     ### 1. Executive Summary
    #     (Write a clear, natural paragraph. **If text:** explain the main purpose and conclusion. **If data/spreadsheet:** explain what the dataset represents, the scope of the data, and any obvious trends or outliers.)

    #     ### 2. Key Insights
    #     (Provide 3-5 bullet points of the most critical facts, decisions, or data patterns.)

    #     ### 3. Quick Reference Data
    #     (Extract specific details to help a user search for this file later. Label them clearly.)
    #     * **Relevant Dates:** [List specific dates or date ranges found]
    #     * **Entities & Stakeholders:** [List names of people, companies, or departments]
    #     * **IDs & References:** [List invoice numbers, order IDs, or transaction codes]
    #     * **Topics / Data Structure:** [List technical terms. **If spreadsheet:** List the key Column Headers here so users can search by column name]
    # """
    prompt = f"""
    You are an expert Data Analyst.


    Task 1: Write a concise, clean **Markdown** summary for a human executive.
    Task 2: Extract specific metadata for search (dates, entities, IDs, technical topics).

    Summarize and analyze the following content, then fill the JSON fields
    user_summary_markdown and index_json according to their descriptions.

    --- Begin Content ---
    {text}
    --- End Content ---

    **Guidelines:**
    1. **user_summary_markdown:** 2-4 sentences executive overview, followed by 3-5 bullet points of key insights.
    2. **Index:** Extract ONLY:
       - "relevant_dates": ["YYYY-MM-DD" or specific dates]
       - "entities": [People, Companies, Stakeholders]
       - "document_ids": [Invoice #s, PO #s, Reference codes]
       - "technical_topics": [Column headers (if CSV), specific product names, technical jargon]
    """

    try:
        # response = model.generate_content(prompt)
        model = genai.GenerativeModel(
            "gemini-2.0-flash",
            generation_config=genai.GenerationConfig(
                temperature=0.2,
                max_output_tokens=2048,
                response_mime_type="application/json",  # required when using response_schema
                response_schema=DOC_SUMMARY_SCHEMA,     # 👈 our schema
            ),
        )
        response = model.generate_content(prompt)
        # full_text = response.text
        data = json.loads(response.text)

        user_summary = data["user_summary_markdown"]
        index_json = data["index_json"]

        text_to_embed = f"{user_summary}\n\nKeywords: {json.dumps(index_json)}"
        
        # Assuming you have a get_embedding function
        embedding = get_embedding(text_to_embed) 

        return user_summary, index_json, embedding
    except Exception as e:
        logger.error(f"LLM Summarizer failed: {e}")
        return "Error generating summary.", {}, []

    # response = model.generate_content(prompt)
    # embedding = get_embedding(response.text)
    # return response.text, embedding


def get_embedding(text):
    """Generates an embedding for the given text using the Google Generative AI API."""

    response = genai.embed_content(
        model="text-embedding-004",
        content=text,
        task_type="SEMANTIC_SIMILARITY",
        output_dimensionality=768,
    )
    return response['embedding']