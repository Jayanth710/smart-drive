# DOC_SUMMARY_SCHEMA = {
#     "type": "object",
#     "properties": {
#         "user_summary_markdown": {
#             "type": "string",
#             "description": (
#                 "A concise Markdown summary for a human reader. "
#                 "2–4 sentences of executive overview, followed by 3–5 bullet points "
#                 "of key insights."
#             ),
#         },
#         "index_json": {
#             "type": "object",
#             "description": "Structured metadata for search and filtering.",
#             "properties": {
#                 "relevant_dates": {
#                     "type": "array",
#                     "description": "Important dates mentioned in the document.",
#                     "items": {
#                         "type": "string",
#                         "description": "Date as found in text (e.g., '2025-01-10', '10 Jan 2025').",
#                     },
#                 },
#                 "entities": {
#                     "type": "array",
#                     "description": "People, companies, stakeholders, departments, etc.",
#                     "items": {
#                         "type": "string",
#                     },
#                 },
#                 "document_ids": {
#                     "type": "array",
#                     "description": "Invoice numbers, PO numbers, contract IDs, case IDs, etc.",
#                     "items": {
#                         "type": "string",
#                         "description": "ID or reference code exactly as in the document.",
#                     },
#                 },
#                 "technical_topics": {
#                     "type": "array",
#                     "description": (
#                         "Technical terms: column headers (if CSV), product/system names, "
#                         "technologies, or domain jargon."
#                     ),
#                     "items": {
#                         "type": "string",
#                     },
#                 },
#             },
#             "required": [
#                 "relevant_dates",
#                 "entities",
#                 "document_ids",
#                 "technical_topics",
#             ]
#         },
#     },
#     "required": ["user_summary_markdown", "index_json"]
# }

DOC_SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "executive_overview": {
            "type": "string",
            "description": "A 2-4 sentence executive overview."
        },
        "key_insights": {
            "type": "array",
            "items": {"type": "string"},
            "description": "3-5 key insights or bullet points."
        },
        "index_json": {
            "type": "object",
            "properties": {
                "relevant_dates": {"type": "array", "items": {"type": "string"}},
                "entities": {"type": "array", "items": {"type": "string"}},
                "document_ids": {"type": "array", "items": {"type": "string"}},
                "technical_topics": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["relevant_dates", "entities", "document_ids", "technical_topics"]
        },
    },
    "required": ["executive_overview", "key_insights", "index_json"]
}