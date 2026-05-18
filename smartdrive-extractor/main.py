import logging
import os

from app.app import create_app
from app.environment import Environment
from utils.docling import get_converter

env = Environment.from_env()

logging.basicConfig(
    level=env.root_log_level,
    format='%(asctime)s [%(levelname)s] [%(name)s] %(message)s',
)
logging.getLogger('starter').setLevel(level=env.starter_log_level)

logger = logging.getLogger(__name__)

# Eager init: docling's first-run model load is the worker's biggest cold-start
# tax. Pay it once at boot so the first Pub/Sub message doesn't.
logger.info("Warming docling converter...")
try:
    get_converter()
    logger.info("Docling converter ready")
except Exception as e:
    logger.warning(f"Docling warm-up failed (will retry lazily): {e}")


if __name__ == "__main__":
    app = create_app(env)
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8080)),
        debug=False,
    )
