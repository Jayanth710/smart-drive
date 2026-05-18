"""Real token counting via tiktoken.

Gemini doesn't ship a local tokenizer; tiktoken's `cl100k_base` is a close-
enough universal approximation (used by GPT-4). It's much more accurate than
`len(text)/4`, especially for code, non-English, and structured text.

If tiktoken isn't installed at runtime, we degrade gracefully to the old
heuristic instead of crashing the worker.
"""

import logging

logger = logging.getLogger(__name__)

_encoder = None
_encoder_init_failed = False


def _get_encoder():
    global _encoder, _encoder_init_failed
    if _encoder is not None or _encoder_init_failed:
        return _encoder
    try:
        import tiktoken
        _encoder = tiktoken.get_encoding("cl100k_base")
    except Exception as e:
        logger.warning(f"tiktoken unavailable, falling back to char/4 heuristic: {e}")
        _encoder_init_failed = True
        _encoder = None
    return _encoder


def count_tokens(text: str) -> int:
    if not text:
        return 0
    enc = _get_encoder()
    if enc is None:
        return max(1, len(text) // 4)
    return len(enc.encode(text))


def truncate_to_tokens(text: str, max_tokens: int) -> str:
    """Truncate text so its token count ≤ max_tokens.

    Used as a safety guard before passing text to an embedding model that
    rejects over-limit inputs (Gemini embed: 2048).
    """
    if not text:
        return text
    enc = _get_encoder()
    if enc is None:
        # Heuristic fallback: trim by char budget.
        max_chars = max_tokens * 4
        return text[:max_chars]
    tokens = enc.encode(text)
    if len(tokens) <= max_tokens:
        return text
    return enc.decode(tokens[:max_tokens])
