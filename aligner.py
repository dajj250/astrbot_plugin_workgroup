# -*- coding: utf-8 -*-
"""实现 SO_HUI_INTERFACE.md 约定的 align(input) -> result。"""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import Any


def _digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _source_files(source: Path):
    if source.is_file():
        yield source.name, source
    else:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                yield path.relative_to(source).as_posix(), path


def align(input: dict[str, Any]) -> dict[str, Any]:
    sources = [Path(item).expanduser().resolve() for item in input.get("sources") or []]
    target = Path(input.get("merge_target") or "").expanduser().resolve()
    policy = input.get("conflict_policy", "abort")
    if policy not in {"abort", "prefer_last"}:
        raise ValueError("conflict_policy 只能是 abort 或 prefer_last")

    missing = [str(source) for source in sources if not source.exists()]
    candidates: dict[str, list[Path]] = {}
    for source in sources:
        if source.exists():
            for relative, path in _source_files(source):
                candidates.setdefault(relative, []).append(path)

    conflicts = []
    selected: dict[str, Path] = {}
    for relative, paths in candidates.items():
        differing = len({_digest(path) for path in paths}) > 1
        destination = target / relative
        destination_conflict = destination.exists() and _digest(destination) != _digest(paths[-1])
        if (differing or destination_conflict) and policy == "abort":
            conflicts.append({
                "path": str(destination),
                "reason": "输入内容冲突" if differing else "目标已存在且内容不同",
                "sources": [str(path) for path in paths],
            })
        else:
            selected[relative] = paths[-1]

    if missing or conflicts:
        return {"ok": False, "merged": [], "conflicts": conflicts, "missing": missing}

    merged = []
    for relative, source in selected.items():
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists() or _digest(destination) != _digest(source):
            shutil.copy2(source, destination)
        merged.append(str(destination))
    return {"ok": True, "merged": merged, "conflicts": [], "missing": []}
