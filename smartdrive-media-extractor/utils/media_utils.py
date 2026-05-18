from faster_whisper import WhisperModel

import os
import subprocess
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - [%(levelname)s] - %(message)s')
logger = logging.getLogger(__name__)


model_size = "small"

_whisper_model: WhisperModel | None = None


def _get_whisper_model() -> WhisperModel:
    """Lazily load the Whisper model once per process."""
    global _whisper_model
    if _whisper_model is None:
        logger.info(f"Loading Whisper model '{model_size}' (one-time per worker)")
        _whisper_model = WhisperModel(model_size, device="cpu", compute_type="int8")
    return _whisper_model


def warm_whisper_model() -> None:
    """Trigger model load at boot so the first message doesn't pay the cost."""
    _get_whisper_model()


def audio_extractor(media_path: str) -> str:
    """Transcribe an audio file to a single string of text.

    faster-whisper streams segments lazily so memory stays bounded even on
    long files — we don't load the full audio into RAM here.
    """
    model = _get_whisper_model()
    segments, info = model.transcribe(media_path, beam_size=5)
    logger.info(
        f"Detected language '{info.language}' with probability {info.language_probability:.4f}"
    )
    text_chunks = " ".join(segment.text.strip() for segment in segments)
    return text_chunks


def video_to_audio(video_path: str):
    """Extract a mono 16kHz WAV from a video using ffmpeg."""
    if not os.path.exists(video_path):
        logger.error(f"Input video file not found at: {video_path}")
        return None

    try:
        output_dir = "/tmp"
        os.makedirs(output_dir, exist_ok=True)
        base_name = os.path.basename(video_path)
        audio_filename = os.path.splitext(base_name)[0] + ".wav"
        output_audio_path = os.path.join(output_dir, audio_filename)

        command = [
            "ffmpeg",
            "-i", video_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            "-y",
            output_audio_path,
        ]
        logger.info(f"Executing ffmpeg command: {' '.join(command)}")
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        if result.stdout:
            logger.debug("ffmpeg stdout: " + result.stdout)
        if result.stderr:
            logger.debug("ffmpeg stderr: " + result.stderr)
        logger.info(f"Audio successfully extracted to: {output_audio_path}")
        return output_audio_path

    except FileNotFoundError:
        logger.error("ffmpeg command not found. Is ffmpeg installed and in PATH?")
        return None
    except subprocess.CalledProcessError as e:
        logger.error(f"ffmpeg failed. Return code: {e.returncode}")
        logger.error(f"ffmpeg stderr: {e.stderr}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error during audio extraction: {e}")
        return None
