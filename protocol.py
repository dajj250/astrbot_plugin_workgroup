"""Small, signed messages exchanged by AstrBot instances in one QQ group."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from typing import Any

PREFIX = "[WG] "
TYPES = {"task", "claim", "result", "error", "cancel", "hello", "proposal", "opinion",
         "glossary", "knowledge", "effort_sync", "mode_sync", "collaboration_sync",
         "scene_sync", "scene_update", "agent_sync", "agent_update",
         "settings_sync", "settings_update", "sync_request", "status_sync", "production_run", "production_result"}
MAX_WIRE_BYTES = 12000
MAX_AGE_SECONDS = 900


def parse_roster(raw: Any) -> dict[str, dict[str, Any]]:
    if isinstance(raw, str):
        raw = json.loads(raw or "{}")
    if not isinstance(raw, dict):
        raise ValueError("bot_roster 必须是 JSON 对象")
    result: dict[str, dict[str, Any]] = {}
    for bot_id, profile in raw.items():
        bot_id = str(bot_id).strip()
        if not re.fullmatch(r"\d{4,20}", bot_id) or not isinstance(profile, dict):
            raise ValueError("bot_roster 的键必须是 Bot QQ 号，值必须是对象")
        skills = profile.get("strengths", [])
        weak = profile.get("weaknesses", [])
        if not isinstance(skills, list) or not isinstance(weak, list):
            raise ValueError("strengths/weaknesses 必须是数组")
        result[bot_id] = {
            "name": str(profile.get("name") or bot_id)[:40],
            "strengths": [str(x).strip()[:50] for x in skills if str(x).strip()][:20],
            "weaknesses": [str(x).strip()[:50] for x in weak if str(x).strip()][:20],
            "priority": max(-100, min(100, int(profile.get("priority", 0)))),
            "model": str(profile.get("model") or "")[:100],
            "ratings": {},
        }
    return result


def choose_bot(work: str, roster: dict[str, dict[str, Any]], *, exclude: set[str] | None = None,
               effort_levels: dict[str, int] | None = None) -> str | None:
    exclude = exclude or set()
    words = set(re.findall(r"[\w\u4e00-\u9fff]+", work.lower()))
    complex_work = len(work) >= 70 or any(word in work.lower() for word in (
        "复杂", "深入", "分析", "审查", "设计", "调试", "排查", "规划", "证明", "安全", "架构", "research", "debug"))
    ranked = []
    for bot_id, profile in roster.items():
        if bot_id in exclude:
            continue
        strengths = profile["strengths"]
        weaknesses = profile["weaknesses"]
        good = sum(2 for x in strengths if x.lower() in work.lower() or x.lower() in words)
        bad = sum(3 for x in weaknesses if x.lower() in work.lower() or x.lower() in words)
        lower = work.lower()
        arena = "webdev" if any(x in lower for x in ("代码", "编程", "开发", "python", "javascript", "网页")) else (
            "agent" if any(x in lower for x in ("规划", "执行", "工具", "代理", "agent")) else "text")
        rating = profile.get("ratings", {}).get(arena, {})
        online = float(rating.get("score", 0)) if isinstance(rating, dict) else 0.0
        level = (effort_levels or {}).get(bot_id, 50)
        try:
            level = max(0, min(100, int(level)))
        except (TypeError, ValueError):
            level = 50
        effort_bonus = level * 0.075 if complex_work else 0
        ranked.append((10 * (good - bad) + online * 5 + effort_bonus, profile["priority"], bot_id))
    if not ranked:
        return None
    ranked.sort(key=lambda x: (-x[0], -x[1], x[2]))
    return ranked[0][2]


def _canonical(data: dict[str, Any]) -> bytes:
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def encode(kind: str, *, task_id: str, from_bot: str, to_bot: str, payload: dict[str, Any], secret: str, attempt: int = 1) -> str:
    if kind not in TYPES or not secret:
        raise ValueError("无效的消息类型或缺少共享密钥")
    body = {
        "v": 1, "type": kind, "task_id": task_id, "from_bot": from_bot,
        "to_bot": to_bot, "attempt": attempt, "ts": int(time.time()), "payload": payload,
    }
    sig = hmac.new(secret.encode("utf-8"), _canonical(body), hashlib.sha256).hexdigest()
    body["sig"] = sig
    wire = PREFIX + _canonical(body).decode("utf-8")
    if len(wire.encode("utf-8")) > MAX_WIRE_BYTES:
        raise ValueError("工作群协议消息超过长度限制")
    return wire


def decode(text: str, *, secret: str, sender_id: str, roster: dict[str, dict[str, Any]], group_id: str, expected_group: str,
           allow_discovery: bool = False, trusted_ids: set[str] | None = None) -> dict[str, Any] | None:
    if not text.startswith(PREFIX):
        return None
    if group_id != expected_group or not secret:
        raise ValueError("工作群或共享密钥不匹配")
    if len(text.encode("utf-8")) > MAX_WIRE_BYTES:
        raise ValueError("协议消息过长")
    body = json.loads(text[len(PREFIX):])
    if not isinstance(body, dict):
        raise ValueError("协议消息格式错误")
    sig = str(body.pop("sig", ""))
    valid = hmac.new(secret.encode("utf-8"), _canonical(body), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, valid):
        raise ValueError("协议签名无效")
    if body.get("v") != 1 or body.get("type") not in TYPES:
        raise ValueError("协议版本或类型无效")
    discovered = allow_discovery and body.get("type") == "hello" and (
        trusted_ids is None or sender_id in trusted_ids)
    if body.get("from_bot") != sender_id or (sender_id not in roster and not discovered):
        raise ValueError("发送 Bot 不匹配")
    if body.get("to_bot") not in roster or not re.fullmatch(r"wg-[a-f0-9]{16}", str(body.get("task_id", ""))):
        raise ValueError("目标 Bot 或任务编号无效")
    if not isinstance(body.get("payload"), dict) or not isinstance(body.get("attempt"), int):
        raise ValueError("协议内容无效")
    if body["attempt"] < 1 or body["attempt"] > 10 or not isinstance(body.get("ts"), int):
        raise ValueError("重试次数或时间戳无效")
    if abs(int(time.time()) - body["ts"]) > MAX_AGE_SECONDS:
        raise ValueError("协议消息已过期")
    return body
