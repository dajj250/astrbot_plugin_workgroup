"""Bounded, replicated work-group notes and vocabulary (not AstrBot's native KB)."""
from __future__ import annotations

import hashlib
import re
import time
from typing import Any

MAX_NOTES = 200
MAX_GLOSSARY = 100


def note_id(title: str, content: str) -> str:
    return hashlib.sha256((title.strip() + "\0" + content.strip()).encode("utf-8")).hexdigest()[:16]


def add_note(state: dict[str, Any], *, title: str, content: str, source_bot: str, task_id: str = "") -> dict[str, Any] | None:
    title, content = str(title).strip()[:120], str(content).strip()[:1800]
    if not title or not content:
        return None
    notes = state.setdefault("knowledge", [])
    identity = note_id(title, content)
    if any(item.get("id") == identity for item in notes):
        return None
    note = {"id": identity, "title": title, "content": content,
            "source_bot": source_bot, "task_id": task_id, "created_at": int(time.time())}
    notes.append(note)
    del notes[:-MAX_NOTES]
    return note


def relevant_notes(state: dict[str, Any], query: str, limit: int = 4) -> list[dict[str, Any]]:
    lower = query.lower()
    terms = set(re.findall(r"[a-z0-9]{2,}", lower))
    for chunk in re.findall(r"[\u4e00-\u9fff]{2,}", lower):
        terms.add(chunk)
        terms.update(chunk[i:i + 2] for i in range(len(chunk) - 1))
    def score(item):
        text = (item.get("title", "") + " " + item.get("content", "")).lower()
        return sum(1 for term in terms if term in text)
    ranked = sorted(state.get("knowledge", []), key=lambda x: (score(x), x.get("created_at", 0)), reverse=True)
    return [item for item in ranked if score(item) > 0][:limit]


def put_glossary(state: dict[str, Any], term: str, meaning: str) -> bool:
    term, meaning = str(term).strip()[:40], str(meaning).strip()[:300]
    if not term or not meaning or "\n" in term:
        return False
    glossary = state.setdefault("glossary", {})
    if term not in glossary and len(glossary) >= MAX_GLOSSARY:
        return False
    glossary[term] = meaning
    return True
