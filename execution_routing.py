"""执行入口判定与真实产物清单；不授予或绕过平台权限。"""
import hashlib
import re
from pathlib import Path


def download_run_succeeded(run: dict) -> bool:
    """Download-only agent runs are complete with tool evidence; they do not need a build report."""
    tools = run.get("tools") if isinstance(run, dict) else None
    if not isinstance(tools, list) or not tools:
        return False
    downloads = [item for item in tools if isinstance(item, dict) and item.get("name") == "workgroup_download"]
    if len(downloads) != len(tools):
        return False
    return all(isinstance(item.get("result"), dict)
               and item["result"].get("status") == "success"
               and item["result"].get("path")
               and item["result"].get("bytes")
               and item["result"].get("sha256")
               and item["result"].get("route") for item in downloads)


def execution_blocker(tools: list, report: Path) -> str:
    """工具调用和执行报告是最低证据要求，不以参考仓库文件数量判成功。"""
    if not tools:
        return "模型未调用任何工具；未确认交付。"
    if not report.is_file() or not report.stat().st_size:
        return "缺少 execution-report.md 执行报告；下载的参考资料不能作为交付证明。"
    try:
        head = report.read_text(encoding="utf-8-sig")[:12000]
    except (OSError, UnicodeError):
        return "execution-report.md 无法读取；未确认交付。"
    if re.search(
        r"(?im)^(?:[-*]\s*)?(?:状态|结论)\s*[：:]\s*(?:\*\*)?"
        r"(?:未完成|BLOCKED\b|FAIL(?:ED)?\b|受阻|失败)", head,
    ):
        return "execution-report.md 明确声明任务未完成或受阻。"
    return ""


def execution_error_message(error: Exception) -> str:
    """仅返回固定错误分类，避免把供应商响应中的私密字段发送到群。"""
    message = str(error).lower()
    if "usage_limit_reached" in message or "insufficient_quota" in message:
        return "模型供应商额度已耗尽；请等待额度恢复或选择其他已配置模型。重复重试或开放电脑权限无法解决。"
    if "429" in message:
        return "模型供应商限流；请稍后重试。"
    return "执行异常；请检查实例日志中的模型或工具错误。"


def requires_local_execution(text: str) -> bool:
    """明确任务涉及本地输入或实际制作时，禁止落入纯文本执行器。"""
    local = bool(re.search(r"[A-Za-z]:[\\/]|/home/|/Users/|/tmp/|本机|本地|数据库|memory", text, re.I))
    action = bool(re.search(r"读取|开发|实现|写入|生成|制作|打包|构建|运行|执行|测试|验证|复核|交付", text))
    artifact = bool(re.search(r"插件|网页|文件|安装包|源码|HTML|JSON|ZIP", text, re.I))
    return action and (local or artifact)


def requests_agent_download(text: str) -> bool:
    """An explicit agent-tool download belongs to team routing, not the host build runner."""
    return "workgroup_download" in str(text) and bool(re.search(r"https?://\S+", str(text), re.I))


def parse_agent_download_request(text: str) -> dict:
    """Parse an explicit Bot/agent matrix without letting a planner drop requested workers."""
    source = str(text or "")
    url_match = re.search(r"https?://[^\s，,；;]+", source, re.I)
    assignments = re.findall(r"(?<!\d)(\d{4,20})/([A-Za-z0-9_.-]{1,64})", source)
    filenames = re.findall(r"(?<![/A-Za-z0-9_.-])([A-Za-z0-9][A-Za-z0-9._-]{1,180}\.md)\b", source, re.I)
    return {"url": url_match.group(0).rstrip("。.!！?)）") if url_match else "",
            "assignments": assignments[:8], "filenames": filenames[:8]}


def artifact_inventory(root: Path) -> list[dict]:
    """递归清点普通文件，不跟随目录链接，不把证据文件计为交付物。"""
    root = root.resolve()
    result = []
    def visit(directory):
        for item in sorted(directory.iterdir()):
            if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
                continue
            if not item.resolve().is_relative_to(root):
                continue
            if item.is_dir():
                visit(item)
            elif item.is_file() and item.name != "execution-evidence.json" and item.stat().st_size:
                digest = hashlib.sha256()
                with item.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(chunk)
                result.append({"path": item.relative_to(root).as_posix(),
                               "bytes": item.stat().st_size, "sha256": digest.hexdigest()})
    visit(root)
    return result
