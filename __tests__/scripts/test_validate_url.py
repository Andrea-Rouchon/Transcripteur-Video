#!/usr/bin/env python3
"""Tests for download.py and transcribe.py validate_url."""

import os
import sys
import unittest

# Make scripts importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from download import validate_url as dl_validate
from transcribe import transcribe  # noqa: F401 – import to confirm module loads


class TestDownloadValidateUrl(unittest.TestCase):
    def test_accepts_youtube(self):
        self.assertTrue(dl_validate("https://www.youtube.com/watch?v=abc"))
        self.assertTrue(dl_validate("https://youtube.com/watch?v=abc"))
        self.assertTrue(dl_validate("https://youtu.be/abc"))

    def test_accepts_vimeo(self):
        self.assertTrue(dl_validate("https://vimeo.com/123456"))
        self.assertTrue(dl_validate("https://www.vimeo.com/123456"))

    def test_rejects_other_domains(self):
        self.assertFalse(dl_validate("https://evil.com/watch?v=abc"))
        self.assertFalse(dl_validate("https://notyoutube.com/abc"))

    def test_rejects_non_http(self):
        self.assertFalse(dl_validate("ftp://youtube.com/abc"))

    def test_rejects_subdomain_injection(self):
        # youtube.com.evil.com should NOT be accepted
        self.assertFalse(dl_validate("https://youtube.com.evil.com/abc"))

    def test_rejects_empty_and_malformed(self):
        self.assertFalse(dl_validate(""))
        self.assertFalse(dl_validate("not-a-url"))


if __name__ == "__main__":
    unittest.main()
