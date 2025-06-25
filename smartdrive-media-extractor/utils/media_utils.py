from faster_whisper import WhisperModel

import os
import subprocess
import logging
import tempfile

logging.basicConfig(level=logging.INFO, format='%(asctime)s - [%(levelname)s] - %(message)s')
logger = logging.getLogger(__name__)


model_size = "small"

def audio_extractor(media_path: str):

    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    # or run on GPU with INT8
    # model = WhisperModel(model_size, device="cuda", compute_type="int8_float16")
    # or run on CPU with INT8
    # model = WhisperModel(model_size, device="cpu", compute_type="int8")

    segments, info = model.transcribe(media_path, beam_size=5)

    print("Detected language '%s' with probability %f" % (info.language, info.language_probability))

    segments = list(segments)

    text_chunks = " ".join(segment.text.strip() for segment in segments)

    return text_chunks

def video_to_audio(video_path: str):
    """
    Extracts the audio track from a video file using ffmpeg and saves it
    as a WAV file in a standard format for transcription models like Whisper.

    Args:
        video_path: The full path to the input video file (e.g., "my_video.mp4").

    Returns:
        The file path to the extracted WAV audio file, or None if an error occurs.
    """
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
            "-i", video_path,       # Specify the input video file
            "-vn",                  # -vn = "No Video": Discard the video stream
            "-acodec", "pcm_s16le", # Audio Codec: Standard for uncompressed WAV
            "-ar", "16000",         # Audio Rate: Resample to 16kHz (optimal for Whisper)
            "-ac", "1",             # Audio Channels: Convert to mono
            "-y",                   # Overwrite the output file if it already exists
            output_audio_path       # The path to save the new audio file
        ]

        logger.info(f"Executing ffmpeg command: {' '.join(command)}")

        result = subprocess.run(command, check=True, capture_output=True, text=True)

        logger.info("ffmpeg stdout: " + result.stdout)
        logger.error("ffmpeg stderr: " + result.stderr)

        logger.info(f"Audio successfully extracted to: {output_audio_path}")
        return output_audio_path

    except FileNotFoundError:
        logger.error("ffmpeg command not found. Is ffmpeg installed and in your system's PATH?")
        return None
    except subprocess.CalledProcessError as e:
        logger.error(f"ffmpeg failed to execute. Return code: {e.returncode}")
        logger.error(f"ffmpeg stderr: {e.stderr}")
        return None
    except Exception as e:
        logger.error(f"An unexpected error occurred during audio extraction: {e}")
        return None