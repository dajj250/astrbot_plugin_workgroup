"""工作台本机制作流程。群内只能选择预先配置的流程名。"""
from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
import zipfile
from pathlib import Path


def load_recipes(root: Path) -> dict:
    path = root / "production_recipes.json"
    if not path.is_file():
        return {}
    recipes = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(recipes, dict):
        raise ValueError("制作流程配置须为 JSON 对象")
    return recipes


def load_workflows(root: Path) -> dict[str, list[dict]]:
    """读取协调实例本地登记的顺序制作流程。"""
    path = root / "production_workflows.json"
    if not path.is_file():
        return {}
    workflows = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(workflows, dict):
        raise ValueError("自动制作配置须为 JSON 对象")
    for name, stages in workflows.items():
        if (not re.fullmatch(r"[a-z0-9_-]{1,40}", name)
                or not isinstance(stages, list) or not 1 <= len(stages) <= 12):
            raise ValueError("自动制作流程名或步骤数量不合法")
        for stage in stages:
            if (not isinstance(stage, dict)
                    or not re.fullmatch(r"[0-9]{4,20}", str(stage.get("bot", "")))
                    or not re.fullmatch(r"[a-z0-9_-]{1,40}", str(stage.get("recipe", "")))):
                raise ValueError("步骤必须指定 Bot QQ 与已登记的制作流程名")
    return workflows


async def run_recipe(root: Path, name: str, recipe: dict) -> Path:
    """使用固定参数运行本机可信程序，核对本次生成的文件后打包。"""
    if not re.fullmatch(r"[a-z0-9_-]{1,40}", name):
        raise ValueError("流程名无效")
    executable = Path(recipe["executable"])
    workspace = Path(recipe["workspace"])
    args = recipe.get("args", [])
    outputs = recipe["outputs"]
    inputs = recipe.get("inputs", [])
    timeout = recipe.get("timeout_seconds", 120)
    if not executable.is_absolute() or not executable.is_file():
        raise ValueError("执行程序须为存在的绝对路径")
    if os.name == "nt" and executable.suffix.lower() != ".exe":
        raise ValueError("Windows 流程须指定 EXE，脚本通过对应解释器运行")
    if not workspace.is_absolute() or not workspace.is_dir():
        raise ValueError("工作目录须为存在的绝对路径")
    if not isinstance(inputs, list) or not all(isinstance(item, str) for item in inputs):
        raise ValueError("输入须为绝对文件路径数组")
    for item in inputs:
        path = Path(item)
        if not path.is_absolute() or not path.is_file():
            raise RuntimeError("缺少预先登记的输入文件")
        try:
            with path.open("rb") as source:
                if not source.read(1):
                    raise RuntimeError("预先登记的输入文件为空")
        except OSError as exc:
            raise RuntimeError("当前实例无法读取预先登记的输入文件") from exc
    if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
        raise ValueError("流程参数须为字符串数组")
    if (not isinstance(outputs, list) or not 1 <= len(outputs) <= 20
            or not all(isinstance(item, str) and re.fullmatch(r"[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+", item)
                       for item in outputs) or len(set(outputs)) != len(outputs)):
        raise ValueError("须声明 1 到 20 个不重复的产物文件名")
    if type(timeout) is not int or not 1 <= timeout <= 900:
        raise ValueError("流程超时须为 1 到 900 秒")
    folder = root / "artifacts"
    folder.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix=f"{name}-", dir=folder))
    output_dir = run_dir / "files"
    output_dir.mkdir()
    env = {**os.environ, "WORKGROUP_OUTPUT_DIR": str(output_dir.resolve())}
    with (run_dir / "run.log").open("wb") as log:
        process = await asyncio.create_subprocess_exec(
            str(executable), *args, cwd=workspace, env=env,
            stdin=asyncio.subprocess.DEVNULL, stdout=log, stderr=log,
        )
        try:
            code = await asyncio.wait_for(process.wait(), timeout=timeout)
        except (TimeoutError, asyncio.CancelledError):
            if process.returncode is None:
                process.kill()
                await process.wait()
            raise
    if code != 0:
        raise RuntimeError(f"执行失败，退出码 {code}。本机日志：{run_dir.name}/run.log")
    paths = [output_dir / item for item in outputs]
    if output_dir.is_symlink() or any(
        path.is_symlink() or path.resolve().parent != output_dir.resolve()
        or not path.is_file() or path.stat().st_size == 0 for path in paths
    ):
        raise RuntimeError("执行结束，但预期产物缺失、为空或不在产物目录")
    if sum(path.stat().st_size for path in paths) > 20 * 1024 * 1024:
        raise RuntimeError("产物超过 20 MiB，未发送群附件")
    archive_path = run_dir / f"{run_dir.name}.zip"
    with zipfile.ZipFile(archive_path, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in paths:
            archive.write(path, arcname=path.name)
    return archive_path
