"""Retry with exponential backoff for transient errors.

We retry on:
  - Rate limits (429)
  - Server errors (500, 502, 503, 504)
  - Network/timeout/deadline-exceeded
  - Anything whose str() contains those signals

We do NOT retry on:
  - Schema/validation errors (400)
  - Auth (401, 403)
  - Not found (404)
  - Anything that looks deterministic
"""

import logging
import random
import time
from typing import Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

_RETRYABLE_SIGNALS = (
    "429", "500", "502", "503", "504",
    "rate limit", "rate-limit", "resource exhausted", "resource_exhausted",
    "deadline exceeded", "deadline_exceeded",
    "timeout", "timed out",
    "internal error", "internal_error",
    "unavailable", "service unavailable",
    "connection reset", "connection refused",
)

_NON_RETRYABLE_SIGNALS = (
    "400", "401", "403", "404",
    "invalid argument", "invalid_argument",
    "permission denied", "permission_denied",
    "unauthenticated",
    "not found",
)


def is_retryable(exc: BaseException) -> bool:
    msg = str(exc).lower()
    if any(s in msg for s in _NON_RETRYABLE_SIGNALS):
        return False
    if any(s in msg for s in _RETRYABLE_SIGNALS):
        return True
    # Default: retry unknown transients; we'd rather burn a few attempts
    # than mark a file failed because of a flaky connection.
    return True


def with_retry(
    fn: Callable[..., T],
    *args,
    max_attempts: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 8.0,
    label: str = "",
    **kwargs,
) -> T:
    last_exc: BaseException | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            last_exc = e
            if attempt == max_attempts or not is_retryable(e):
                if not is_retryable(e):
                    logger.warning(f"retry {label}: non-retryable error, giving up: {e}")
                else:
                    logger.warning(f"retry {label}: exhausted {max_attempts} attempts: {e}")
                raise
            # Exponential backoff with jitter — avoids thundering herd on rate-limit waves.
            delay = min(max_delay, base_delay * (2 ** (attempt - 1)))
            delay = delay * (0.5 + random.random() / 2)
            logger.info(f"retry {label}: attempt {attempt}/{max_attempts} failed ({e}); sleeping {delay:.2f}s")
            time.sleep(delay)
    # Should never reach here.
    if last_exc:
        raise last_exc
    raise RuntimeError("with_retry exhausted without exception")
