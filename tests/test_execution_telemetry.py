import ast
import time
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace


class TelemetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_hook_records_io_metadata_without_content(self):
        tree = ast.parse((Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8"))
        hooks = next(n for n in ast.walk(tree) if isinstance(n, ast.ClassDef) and n.name == "ExecutionTimeline")
        hooks.bases = []
        run = {"tools": []}
        scope = {"run": run, "time": time, "uuid": uuid}
        exec(compile(ast.Module(body=[hooks], type_ignores=[]), "hooks", "exec"), scope)
        hook = scope["ExecutionTimeline"]()
        tool = SimpleNamespace(name="astrbot_file_write_tool")
        await hook.on_tool_start(None, tool, {"path": "C:/output/report.md", "content": "private body"})
        event = run["tools"][0]
        self.assertEqual(event["file"], "C:/output/report.md")
        self.assertEqual(event["direction"], "write")
        self.assertNotIn("private body", str(event))
        await hook.on_tool_end(None, tool, {}, SimpleNamespace(isError=False))
        self.assertIn("ended_at", event)
        self.assertIn("ms", event)
        await hook.on_tool_start(None, SimpleNamespace(name="astrbot_execute_shell"), {"command": "private command"})
        self.assertEqual(run["tools"][-1]["file"], "")
        self.assertNotIn("private command", str(run))
