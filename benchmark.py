"""Optional, cached public Arena model-ranking evidence for automatic routing.

Arena publishes its leaderboard dataset under CC BY 4.0. A model that cannot be
matched is deliberately left unranked; it is never assigned an invented score.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path
from typing import Any

DATASET = "lmarena-ai/leaderboard-dataset"
ENDPOINT = "https://datasets-server.huggingface.co/rows"
SOURCE = "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset"
ARENAS = ("agent", "text", "webdev")
TTL = 24 * 3600


def normalize_model(value: str) -> str:
    value = str(value or "").split("/")[-1].lower()
    return re.sub(r"[^a-z0-9]+", "", value)


def match_score(model: str, rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    wanted = normalize_model(model)
    if len(wanted) < 5:
        return None
    exact = [row for row in rows if normalize_model(row.get("model_name", "")) == wanted]
    # Provider IDs commonly omit a leaderboard's effort suffix. Require a long
    # common prefix so e.g. GPT-6 and GPT-6.1 are never silently conflated.
    candidates = exact or [row for row in rows if len(wanted) >= 8 and (
        normalize_model(row.get("model_name", "")).startswith(wanted)
        or wanted.startswith(normalize_model(row.get("model_name", "")))
    )]
    if not candidates:
        return None
    best = min(candidates, key=lambda row: int(row.get("rank") or 9999))
    return {"model_name": best["model_name"], "rank": int(best["rank"]),
            "score": max(0.0, 1.0 - (int(best["rank"]) - 1) / 100.0),
            "approximate": not bool(exact)}


class ArenaBenchmarks:
    def __init__(self, path: Path):
        self.path = path
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            self.data = data if isinstance(data, dict) else {}
        except (FileNotFoundError, OSError, ValueError):
            self.data = {}
        self._lock = asyncio.Lock()
        self._last_attempt = 0.0

    @staticmethod
    def _fetch() -> dict[str, Any]:
        import requests

        result: dict[str, Any] = {"updated_at": int(time.time()), "source": SOURCE, "arenas": {}}
        for arena in ARENAS:
            response = requests.get(ENDPOINT, params={"dataset": DATASET, "config": arena,
                                "split": "latest", "offset": 0, "length": 100}, timeout=8)
            response.raise_for_status()
            data = response.json()
            rows = [item.get("row", {}) for item in data.get("rows", [])]
            rows = [row for row in rows if row.get("category") == "overall" and
                    isinstance(row.get("rank"), (int, float)) and isinstance(row.get("model_name"), str)]
            if not rows:
                raise ValueError(f"Arena {arena} 没有可用的总榜数据")
            result["arenas"][arena] = {
                "date": str(rows[0].get("leaderboard_publish_date") or ""),
                "rows": [{"model_name": r["model_name"], "rank": int(r["rank"])} for r in rows],
            }
        return result

    async def ensure(self) -> bool:
        if time.time() - int(self.data.get("updated_at") or 0) < TTL and self.data.get("arenas"):
            return True
        if time.time() - self._last_attempt < 3600:
            return bool(self.data.get("arenas"))
        async with self._lock:
            if time.time() - int(self.data.get("updated_at") or 0) < TTL and self.data.get("arenas"):
                return True
            if time.time() - self._last_attempt < 3600:
                return bool(self.data.get("arenas"))
            self._last_attempt = time.time()
            try:
                data = await asyncio.to_thread(self._fetch)
                self.path.parent.mkdir(parents=True, exist_ok=True)
                tmp = self.path.with_suffix(".tmp")
                tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                tmp.replace(self.path)
                self.data = data
                return True
            except Exception:
                # Retain a previously cached snapshot; no score is fabricated.
                return bool(self.data.get("arenas"))

    def ratings(self, model: str) -> dict[str, dict[str, Any]]:
        return {name: match for name, item in self.data.get("arenas", {}).items()
                if (match := match_score(model, item.get("rows", []))) is not None}
