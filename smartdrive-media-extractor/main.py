import logging
import os
from app.app import create_app
from utils.media_utils import warm_whisper_model
from smartdrive_core.mongo_status import sweep_orphaned_files

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] [%(name)s] %(message)s',
)

logger = logging.getLogger(__name__)

# Eager init: Whisper model load (~1.5GB for "small") is the cold-start tax.
# Pay it once at boot so the first message doesn't see a 10–30s pause.
logger.info("Warming Whisper model...")
try:
    warm_whisper_model()
    logger.info("Whisper model ready")
except Exception as e:
    logger.warning(f"Whisper warm-up failed (will retry lazily): {e}")

# Sweep orphaned media files (worker died mid-transcription).
try:
    n = sweep_orphaned_files(stale_minutes=15)  # media takes longer than docs
    if n > 0:
        logger.warning(f"Reset {n} orphaned media file(s) on boot — re-extraction queued")
except Exception as e:
    logger.warning(f"Orphan sweep failed (non-fatal): {e}")


if __name__ == "__main__":
    app = create_app()
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8080)),
        debug=False,
    )
