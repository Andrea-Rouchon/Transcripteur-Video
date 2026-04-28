#!/usr/bin/env python3
"""
Transcribe an audio file using OpenAI Whisper (local).
Usage: python transcribe.py <audio_path> [model_name]
Outputs JSON to stdout: { "segments": [{start, end, text}], "language": "..." }
Exits with code 1 on error.
"""

import json
import os
import sys


def transcribe(audio_path: str, model_name: str) -> dict:
    try:
        import whisper
    except ImportError as exc:
        raise ImportError(
            "openai-whisper n'est pas installé. Exécute : pip install openai-whisper"
        ) from exc

    if not os.path.isfile(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    # Redirect stdout to stderr during Whisper so its progress messages
    # don't corrupt the JSON written to stdout at the end.
    old_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        model = whisper.load_model(model_name)
        result = model.transcribe(audio_path, verbose=False)
    finally:
        sys.stdout = old_stdout

    segments = [
        {
            "start": round(seg["start"], 2),
            "end": round(seg["end"], 2),
            "text": seg["text"].strip(),
        }
        for seg in result.get("segments", [])
    ]

    return {
        "language": result.get("language", ""),
        "segments": segments,
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: transcribe.py <audio_path> [model_name]", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    model_name = (
        sys.argv[2] if len(sys.argv) > 2 else os.environ.get("WHISPER_MODEL", "base")
    )

    try:
        output = transcribe(audio_path, model_name)
        print(json.dumps(output, ensure_ascii=False))
    except ImportError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)  # exit 2 = whisper not installed
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(3)  # exit 3 = audio file not found
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(4)  # exit 4 = transcription failed


if __name__ == "__main__":
    main()
