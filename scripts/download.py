#!/usr/bin/env python3
"""
Download audio from a YouTube or Vimeo URL using yt-dlp.
Usage: python download.py <url> <output_path>
Outputs the final audio file path to stdout on success.
Exits with code 1 on error.
"""

import json
import subprocess
import sys

ALLOWED_DOMAINS = (
    "youtube.com",
    "www.youtube.com",
    "youtu.be",
    "vimeo.com",
    "www.vimeo.com",
)

MAX_DURATION_SECONDS = 7200  # 2 hours


def validate_url(url: str) -> bool:
    from urllib.parse import urlparse

    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        host = parsed.netloc.lower()
        return any(host == d or host.endswith("." + d) for d in ALLOWED_DOMAINS)
    except Exception:
        return False


def check_duration(url: str) -> int:
    """Return video duration in seconds using yt-dlp --dump-json."""
    result = subprocess.run(
        ["yt-dlp", "--dump-json", "--no-playlist", url],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp metadata error: {result.stderr.strip()}")
    info = json.loads(result.stdout)
    return int(info.get("duration") or 0)


def download_audio(url: str, output_path: str) -> str:
    """Download audio to output_path (without extension). Returns final file path."""
    result = subprocess.run(
        [
            "yt-dlp",
            "--no-playlist",
            "-x",  # extract audio
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "-o",
            output_path,
            url,
        ],
        capture_output=True,
        text=True,
        timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp download error: {result.stderr.strip()}")
    return output_path


def main():
    if len(sys.argv) != 3:
        print("Usage: download.py <url> <output_path>", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]
    output_path = sys.argv[2]

    if not validate_url(url):
        print(f"ERROR: URL not allowed: {url}", file=sys.stderr)
        sys.exit(2)  # exit 2 = URL not allowed

    try:
        duration = check_duration(url)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(4)  # exit 4 = metadata/network error

    if duration > MAX_DURATION_SECONDS:
        print(
            f"ERROR: La vidéo dépasse la durée maximale autorisée ({MAX_DURATION_SECONDS // 3600}h).",
            file=sys.stderr,
        )
        sys.exit(3)  # exit 3 = duration exceeded

    try:
        final_path = download_audio(url, output_path)
        print(final_path)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(5)  # exit 5 = download error


if __name__ == "__main__":
    main()
