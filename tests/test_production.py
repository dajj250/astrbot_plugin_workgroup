import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from production import load_workflows, run_recipe


class ProductionTests(unittest.IsolatedAsyncioTestCase):
    def test_workflow_keeps_registered_order_and_rejects_path_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "production_workflows.json"
            stages = [{"bot": "1000000002", "recipe": "audit"}, {"bot": "1000000003", "recipe": "build"}]
            path.write_text(json.dumps({"memory-build": stages}), encoding="utf-8")
            self.assertEqual(load_workflows(root)["memory-build"], stages)
            stages[1]["recipe"] = "../build.py"
            path.write_text(json.dumps({"memory-build": stages}), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_workflows(root)

    async def test_real_subprocess_creates_attachment(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            recipe = {
                "executable": sys.executable,
                "workspace": tmp,
                "args": [
                    "-c",
                    "import os; from pathlib import Path; "
                    "(Path(os.environ['WORKGROUP_OUTPUT_DIR']) / 'data.json').write_text('{}')",
                ],
                "outputs": ["data.json"],
            }
            result = await run_recipe(root, "build", recipe)
            with zipfile.ZipFile(result) as archive:
                self.assertEqual(archive.read("data.json"), b"{}")

    async def test_exit_zero_without_output_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            recipe = {
                "executable": sys.executable,
                "workspace": tmp,
                "args": ["-c", "pass"],
                "outputs": ["data.json"],
            }
            with self.assertRaisesRegex(RuntimeError, "产物缺失"):
                await run_recipe(Path(tmp), "build", recipe)
