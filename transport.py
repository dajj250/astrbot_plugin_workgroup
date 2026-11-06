"""Bot 之间的本机后台通道。

心跳、任务派发、结果回传等内部协议消息不再写入群聊，
改由同一台机器上的共享目录投递；群消息只保留给人看的文字。

设计要点：
* 目录按 Bot QQ 号寻址，写入用临时文件 + ``os.replace`` 原子落盘；
* 消费方用原子改名“认领”文件，避免多个实例重复处理同一条消息；
* ``presence`` 目录记录本机在线实例，用于判断对端是否支持本机通道；
* 任何异常都只返回 False；默认不把 ``[WG]`` 内部协议泄露到群聊。
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

PRESENCE_TTL_SECONDS = 180
MESSAGE_TTL_SECONDS = 120


class WireEvent:
    """把本机通道消息包装成最小事件对象，复用原有协议处理逻辑。"""

    def __init__(self, *, umo: str, group_id: str, self_id: str, sender_id: str, text: str = ""):
        self.unified_msg_origin = umo
        self.message_str = text
        self.message_obj = None
        self.is_at_or_wake_command = False
        self.group_id = group_id
        self.self_id = self_id
        self.sender_id = sender_id

    def get_group_id(self) -> str:
        return self.group_id

    def get_self_id(self) -> str:
        return self.self_id

    def get_sender_id(self) -> str:
        return self.sender_id

    def get_platform_id(self) -> str:
        origin = self.unified_msg_origin or ""
        return origin.split(":", 1)[0] if ":" in origin else ""

    def stop_event(self) -> None:
        return None


class LocalChannel:
    """基于共享目录的本机后台通道。"""

    def __init__(self, directory: Path | str, *, enabled: bool = True):
        self.root = Path(directory)
        self.queue = self.root / "queue"
        self.claimed = self.root / "claimed"
        self.presence_dir = self.root / "presence"
        self.enabled = bool(enabled)
        self.error = ""

    def ensure(self) -> None:
        for path in (self.queue, self.claimed, self.presence_dir):
            path.mkdir(parents=True, exist_ok=True)

    def put(self, to_bot: str, wire: str, from_bot: str = "") -> bool:
        """投递一条线协议文本；返回是否成功写入本机通道。"""
        if not self.enabled or not to_bot or not wire:
            return False
        try:
            self.ensure()
            name = f"{int(time.time() * 1000):013d}-{uuid.uuid4().hex[:12]}.json"
            payload = {"v": 1, "to": str(to_bot), "from": str(from_bot),
                       "ts": int(time.time()), "wire": wire}
            tmp = self.queue / (name + ".tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self.queue / name)
            self.error = ""
            return True
        except OSError as exc:
            self.error = str(exc)[:200]
            return False

    def presence(self, bot_id: str) -> None:
        """登记本实例在线，供其他实例判断能否走本机通道。"""
        if not self.enabled or not bot_id:
            return
        try:
            self.ensure()
            target = self.presence_dir / f"{bot_id}.json"
            tmp = target.with_suffix(".json.tmp")
            tmp.write_text(json.dumps({"bot_id": bot_id, "ts": int(time.time())}), encoding="utf-8")
            os.replace(tmp, target)
        except OSError as exc:
            self.error = str(exc)[:200]

    def local_peers(self) -> dict[str, float]:
        """返回最近仍活跃的本机 Bot 及其最后登记时间。"""
        if not self.enabled:
            return {}
        try:
            files = list(self.presence_dir.glob("*.json"))
        except OSError:
            return {}
        now, result = time.time(), {}
        for file in files:
            try:
                data = json.loads(file.read_text(encoding="utf-8"))
                bot_id = str(data.get("bot_id") or "")
                stamp = float(data.get("ts") or 0)
            except (OSError, ValueError, TypeError):
                continue
            if bot_id and now - stamp <= PRESENCE_TTL_SECONDS:
                result[bot_id] = stamp
        return result

    def drain(self, bot_id: str) -> list[tuple[str, str]]:
        """取出并认领发给自己的消息，返回 (发送 Bot, 线协议文本) 列表。"""
        if not self.enabled or not bot_id:
            return []
        try:
            self.ensure()
            files = sorted(self.queue.glob("*.json"))
        except OSError:
            return []
        items: list[tuple[str, str]] = []
        for file in files:
            try:
                data = json.loads(file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(data, dict) or str(data.get("to") or "") != bot_id:
                continue
            claimed = self.claimed / f"{file.name}.{bot_id}"
            try:
                os.replace(file, claimed)
            except OSError:
                continue
            try:
                wire = str(data.get("wire") or "")
                sender = str(data.get("from") or "")
            finally:
                try:
                    claimed.unlink()
                except OSError:
                    pass
            if wire:
                items.append((sender, wire))
        return items

    def prune(self) -> int:
        """清理过期消息和认领残留，避免离线实例留下垃圾。"""
        if not self.enabled:
            return 0
        cutoff = time.time() - MESSAGE_TTL_SECONDS
        removed = 0
        for folder in (self.queue, self.claimed):
            try:
                files = list(folder.iterdir())
            except OSError:
                continue
            for file in files:
                try:
                    if file.stat().st_mtime < cutoff:
                        file.unlink()
                        removed += 1
                except OSError:
                    continue
        return removed
