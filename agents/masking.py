"""Personal-data masking for traces, logs and the screen.

The national ID, email and phone patterns match the synthetic scenario data.
Applicant names are masked too, because the scenario treats every case as health and disability data.
"""
from __future__ import annotations

import re

_PATTERNS = [
    (re.compile(r"\bNID-?\d{4}-?\d{7}-?\d\b"), "[NATIONAL-ID]"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[EMAIL]"),
    (re.compile(r"(?:\+00|\b0)[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{4}\b"), "[PHONE]"),
    (re.compile(r"\bTest Applicant \w+"), "[NAME]"),
    (re.compile(r"\bcsr_live_[0-9a-f]{6}([0-9a-f]+)"), "csr_live_••••"),
]


def mask(text: str) -> str:
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def looks_like_record(text: str) -> bool:
    """True when a payload carries an applicant's identifiers (what the attacker is after)."""
    return bool(_PATTERNS[0][0].search(text) or _PATTERNS[2][0].search(text) or _PATTERNS[1][0].search(text))
