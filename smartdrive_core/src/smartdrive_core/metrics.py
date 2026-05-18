"""Tiny timing helper. Wrap a stage; get a structured log line with ms duration.

Cheap observability that doesn't require a metrics backend. Once you wire
Cloud Monitoring / Prometheus, swap the `log` call for emission.
"""

import logging
import time
from contextlib import contextmanager
from typing import Iterator

logger = logging.getLogger(__name__)


@contextmanager
def stage_timer(stage: str, **fields) -> Iterator[None]:
    """Time a block and log `stage_done stage=... ms=... key=val …`."""
    start = time.perf_counter()
    extras = " ".join(f"{k}={v}" for k, v in fields.items() if v is not None)
    try:
        yield
    except Exception:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.error(f"stage_failed stage={stage} ms={elapsed_ms:.0f} {extras}")
        raise
    else:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info(f"stage_done stage={stage} ms={elapsed_ms:.0f} {extras}")
