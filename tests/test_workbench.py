import unittest

from workbench import (
    add_receipt,
    archive_project,
    create_task_project,
    finish_project,
    health_report,
    find_agent,
    clean_instance_settings,
    merge_public_scene,
    public_scene,
    set_agent_assignment,
    set_agent_effort,
    set_agent_model,
    sync_scene_agents,
    sync_scenes,
    update_memory,
    upsert_project,
    upsert_scene,
)


class WorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.state = {}
        self.roster = {
            "10001": {"name": "协调", "strengths": ["规划"], "weaknesses": []},
            "10002": {"name": "开发", "strengths": ["Python"], "weaknesses": ["排版"]},
        }
        sync_scenes(self.state, self.roster, "10001")

    def test_sync_is_non_destructive(self):
        scene = self.state["workbench"]["scenes"]["scene-10002"]
        scene["mission"] = "用户定制职责"
        sync_scenes(self.state, self.roster, "10001")
        self.assertEqual(scene["mission"], "用户定制职责")

    def test_project_receipt_and_archive_closed_loop(self):
        project = create_task_project(
            self.state, task_id="wg-1", summary="完成升级",
            owner_scene_id="scene-10001", acceptance="测试通过", actor="owner",
        )
        add_receipt(
            self.state, task_id="wg-1", project_id=project["id"],
            scene_id="scene-10002", status="done", conclusion="已完成",
            evidence="单元测试 8/8 通过",
        )
        finish_project(self.state, project["id"], successful=True)
        self.assertEqual(project["status"], "done")
        self.assertEqual(project["evidence"][0]["text"], "单元测试 8/8 通过")
        archive_project(self.state, project["id"], actor="owner")
        self.assertEqual(project["status"], "archived")

    def test_health_reports_difference_set(self):
        project = upsert_project(self.state, {"name": "缺字段项目"}, actor="owner")
        report = health_report(
            self.state, ready=True, roster=self.roster, leader="10001",
            channel_ready=True,
        )
        codes = {item["code"] for item in report["issues"]}
        self.assertIn("project.no_owner", codes)
        self.assertIn("project.no_acceptance", codes)
        self.assertEqual(report["status"], "error")
        project["owner_scene_id"] = "scene-10001"
        project["acceptance"] = "有证据"
        report = health_report(
            self.state, ready=True, roster=self.roster, leader="10001",
            channel_ready=True,
        )
        self.assertEqual(report["status"], "healthy")

    def test_handoff_is_bounded(self):
        memory = update_memory(
            self.state, "scene-10001", {"handoff": "甲" * 5000}, actor="owner",
        )
        self.assertLessEqual(len(memory["handoff"].encode("utf-8")), 4096)

    def test_custom_scene_validation(self):
        scene = upsert_scene(self.state, {"name": "校对", "mission": "复核证据",
            "boundaries": "不代改执行场景记忆"}, actor="owner")
        self.assertTrue(scene["id"].startswith("scene-"))
        with self.assertRaises(ValueError):
            upsert_scene(self.state, {"name": ""}, actor="owner")

    def test_primary_and_subagent_have_two_effort_modes(self):
        sync_scene_agents(self.state, "10001", [{"id": "research", "name": "研究",
            "role": "核对资料", "source": "astrbot"}])
        set_agent_effort(self.state, "scene-10001", "primary", 70, mode="work", actor="owner")
        set_agent_effort(self.state, "scene-10001", "primary", 30, mode="leisure", actor="owner")
        set_agent_effort(self.state, "scene-10001", "research", 90, mode="work", actor="owner")
        set_agent_effort(self.state, "scene-10001", "research", 10, mode="leisure", actor="owner")
        sync_scene_agents(self.state, "10001", [{"id": "research", "name": "研究",
            "role": "核对资料", "source": "astrbot"}])
        primary = find_agent(self.state, "10001", "primary")
        research = find_agent(self.state, "10001", "research")
        self.assertEqual((primary["work_effort"], primary["leisure_effort"]), (70, 30))
        self.assertEqual((research["work_effort"], research["leisure_effort"]), (90, 10))

    def test_public_scene_never_exports_private_handoff(self):
        scene = self.state["workbench"]["scenes"]["scene-10001"]
        scene["memory"]["handoff"] = "私密交接"
        payload = public_scene(scene)
        self.assertNotIn("memory", payload)
        target = {}
        sync_scenes(target, self.roster, "10001")
        target_scene = target["workbench"]["scenes"]["scene-10001"]
        target_scene["memory"]["handoff"] = "本机原有记忆"
        merge_public_scene(target, payload, actor="10001")
        self.assertEqual(target_scene["memory"]["handoff"], "本机原有记忆")

    def test_assignment_model_and_public_settings_are_bounded(self):
        set_agent_assignment(self.state, "scene-10001", "primary", "画图", actor="owner")
        set_agent_model(self.state, "scene-10001", "primary", "provider-drawing", actor="owner")
        primary = find_agent(self.state, "10001", "primary")
        self.assertEqual((primary["role"], primary["provider_id"]), ("画图", "provider-drawing"))
        cleaned = clean_instance_settings("10001", {"routing_mode": "model_auto",
            "protocol_secret": "never-export", "task_timeout_sec": 9999})
        self.assertEqual(cleaned["routing_mode"], "model_auto")
        self.assertEqual(cleaned["task_timeout_sec"], 900)
        self.assertNotIn("protocol_secret", cleaned)

    def test_subagent_assignment_counts_as_task_description(self):
        sync_scene_agents(self.state, "10001", [{"id": "xiaofeiyu", "name": "xiaofeiyu",
            "role": "画图", "description": "", "source": "astrbot"}])
        agent = find_agent(self.state, "10001", "xiaofeiyu")
        self.assertEqual(agent["description"], "适合处理：画图")
        report = health_report(self.state, ready=True, roster=self.roster, leader="10001",
                               channel_ready=True)
        self.assertNotIn("agent.no_description", {item["code"] for item in report["issues"]})


if __name__ == "__main__":
    unittest.main()
