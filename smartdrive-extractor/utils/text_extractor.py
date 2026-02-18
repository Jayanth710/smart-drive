import os

TEXT_EXT = {
    ".txt", ".md", ".log", ".csv", ".tsv",
    ".py", ".js", ".ts", ".java", ".go", ".sql",
    ".json", ".yaml", ".yml", ".sh"
}

def extract_plain_text(file_path: str) -> dict:
    ext = os.path.splitext(file_path)[1].lower()

    if ext not in TEXT_EXT:
        return {"created": False, "message": f"Plain-text fallback not supported for ext={ext}", "markdown": "", "metadata": {}}

    with open(file_path, "rb") as f:
        text = f.read().decode("utf-8", errors="replace").strip()

    if not text:
        return {"created": False, "message": "Empty file", "markdown": "", "metadata": {}}

    return {
        "created": True,
        "markdown": text,                 # keep key name same for downstream
        "metadata": {"ext": ext, "fallback": "plain_text"},
        "message": "Extracted via plain-text fallback",
    }