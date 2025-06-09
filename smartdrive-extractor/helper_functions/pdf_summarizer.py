from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage
from langchain_core.documents import Document
from langchain_text_splitters import CharacterTextSplitter
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Init Gemini model
llm = ChatGoogleGenerativeAI(model="gemini-2.0-flash")

# Split if needed
def split_text(text, chunk_size=3000, chunk_overlap=200):
    """Split text into chunks of size chunk_size with overlap of chunk_overlap."""
    splitter = CharacterTextSplitter(chunk_size=3000, chunk_overlap=200)
    chunks = splitter.split_text(text)
    docs = [Document(page_content=chunk) for chunk in chunks]  # just first chunk for safety

    # Prepare the full context
    combined_text = "\n\n".join(doc.page_content for doc in docs)
    return combined_text


def LLM_summarizer(text):
    """Summarize a PDF file using LangChain's Gemini model."""
    # Direct Gemini call via LangChain
    combined_text = split_text(text)
    response = llm.invoke([
        HumanMessage(
            content= f"""
Summarize the following document clearly and concisely without missing any important information. Organize the key points using bullet-style phrasing, but present the summary as a well-structured paragraph. Focus only on what is relevant and meaningful in the document.

--- Begin Document ---
{combined_text}
--- End Document ---
"""

        )
    ])
    return response.content
