import ast
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "main.py").read_text(encoding="utf-8")


class ComputerGateTests(unittest.TestCase):
    def test_safe_computer_mode_is_fail_closed(self):
        tree = ast.parse(SOURCE)
        methods = {
            node.name: node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        self.assertIn("gate_group_computer_tools", methods)
        gate = ast.get_source_segment(SOURCE, methods["gate_group_computer_tools"])
        self.assertIn("sender == self.owner", gate)
        self.assertIn("explicit_task", gate)
        self.assertIn("COMPUTER_TOOLS", gate)
        self.assertIn("toolset.tools = kept", gate)

    def test_host_execution_tools_are_not_allowlisted(self):
        module = ast.parse(SOURCE)
        assignment = next(
            node for node in module.body
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "COMPUTER_TOOLS" for target in node.targets)
        )
        allowed = ast.literal_eval(assignment.value)
        self.assertEqual(allowed, {
            "astrbot_cua_screenshot", "astrbot_cua_mouse_click", "astrbot_cua_keyboard_type"
        })
        self.assertFalse(any("shell" in name or "python" in name or "file" in name for name in allowed))
        self.assertIn('"file_"', SOURCE)
        self.assertIn('"execute"', SOURCE)

    def test_session_defaults_to_disabled(self):
        schema = (ROOT / "_conf_schema.json").read_text(encoding="utf-8")
        self.assertIn('"computer_control_enabled"', schema)
        self.assertIn('"default": false', schema)

    def test_work_replies_are_paragraph_formatted_and_public(self):
        self.assertIn("def format_work_reply", SOURCE)
        self.assertIn("三个标题各自单独成段", SOURCE)
        self.assertIn("worker_announced", SOURCE)
        self.assertIn("子任务 {i + 1} 回执", SOURCE)
        self.assertIn('"\\n\\n".join(lines)', SOURCE)


if __name__ == "__main__":
    unittest.main()
