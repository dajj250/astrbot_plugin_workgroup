import ast
import re
import hashlib
import tempfile
import unittest
from pathlib import Path

from execution_routing import (artifact_inventory, download_run_succeeded, execution_blocker,
                               execution_error_message, parse_agent_download_request,
                               requests_agent_download,
                               requires_local_execution)


class ExecutionRoutingTests(unittest.TestCase):
    def test_download_tool_evidence_does_not_require_build_report(self):
        run = {"tools": [{"name": "workgroup_download", "result": {
            "status": "success", "path": "C:/artifact/readme.md", "bytes": 42,
            "sha256": "a" * 64, "route": "proxy"}}]}
        self.assertTrue(download_run_succeeded(run))
        run["tools"][0]["result"].pop("sha256")
        self.assertFalse(download_run_succeeded(run))

    def test_reference_files_do_not_replace_execution_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "reference.py").write_text("# downloaded source")
            report = root / "execution-report.md"
            self.assertIn("缺少", execution_blocker([{"name": "shell"}], report))
            report.write_text("commands and remaining work")
            self.assertEqual(execution_blocker([{"name": "shell"}], report), "")
            self.assertIn("未调用", execution_blocker([], report))
            report.write_text("# 执行报告\n\n- 状态：未完成；等待目标源码。\n", encoding="utf-8")
            self.assertIn("明确声明", execution_blocker([{"name": "shell"}], report))

    def test_quota_error_does_not_leak_raw_response(self):
        msg = execution_error_message(RuntimeError("429 usage_limit_reached secret-token"))
        self.assertIn("额度已耗尽", msg)
        self.assertNotIn("secret-token", msg)
        self.assertIn("限流", execution_error_message(RuntimeError("429")))

    def test_real_memory_task_requires_tools(self):
        self.assertTrue(requires_local_execution(
            r"依据实施单和真实 memory 数据库开发插件并打包到 D:\Work\output"))
        self.assertTrue(requires_local_execution("制作单文件 HTML 网页并交付源码"))
        self.assertTrue(requires_local_execution("读取 /home/user/input.json 验证真实记录"))

    def test_explicit_agent_download_stays_in_team_router(self):
        text = "六名代理分别执行 workgroup_download 下载文件 https://example.org/README.md"
        self.assertTrue(requires_local_execution(text))
        self.assertTrue(requests_agent_download(text))
        self.assertFalse(requests_agent_download("下载 https://example.org/README.md"))

    def test_explicit_download_matrix_preserves_assignments_and_filenames(self):
        parsed = parse_agent_download_request(
            "指定 1000000001/primary、1000000003/xiaofeiyu 调用 workgroup_download "
            "下载 https://example.org/README.md，分别保存为 WG-A.md、WG-B.md。")
        self.assertEqual(parsed["url"], "https://example.org/README.md")
        self.assertEqual(parsed["assignments"], [("1000000001", "primary"),
                                                  ("1000000003", "xiaofeiyu")])
        self.assertEqual(parsed["filenames"], ["WG-A.md", "WG-B.md"])

    def test_plain_discussion_stays_text(self):
        self.assertFalse(requires_local_execution("总结今天的讨论并分配职责"))
        self.assertFalse(requires_local_execution("解释数据库是什么"))

    def test_inventory_reads_nested_real_files_and_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "src").mkdir()
            (root / "src" / "test.py").write_bytes(b"actual content")
            (root / "empty").touch()
            (root / "execution-evidence.json").write_text("{}")
            self.assertEqual(artifact_inventory(root), [{
                "path": "src/test.py", "bytes": 14,
                "sha256": hashlib.sha256(b"actual content").hexdigest(),
            }])


class CommandPrefixRegressionTests(unittest.TestCase):
    def test_raw_message_restores_stripped_wake_prefix(self):
        source = (Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        handler = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "on_group_message")
        restore = next(n for n in ast.walk(handler) if isinstance(n, ast.If)
                       and ast.unparse(n.test) == "native_text.startswith('/')")
        namespace = {"native_text": "/任务 本机生成文件", "text": "任务 本机生成文件"}
        exec(compile(ast.Module(body=[restore], type_ignores=[]), "prefix", "exec"), namespace)
        self.assertIsNotNone(re.fullmatch(r"/任务(?:\s+(.*))?", namespace["text"], re.S))
