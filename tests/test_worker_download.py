"""分工下载必须由模型工具调用触发；文本声明不能算执行证据。"""
import ast
import asyncio
import json
import re
import sys
import tempfile
import time
import types
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch


class WorkerDownloadTests(unittest.IsolatedAsyncioTestCase):
    async def exercise(self, *, call=True, enabled=True):
        tree = ast.parse(Path('main.py').read_text(encoding='utf-8'))
        method = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)
                      and n.name == 'run_worker_download')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            downloads = []
            def download(url, folder, filename, mode, proxy):
                downloads.append(filename)
                path = folder / filename
                path.write_text('real test fixture', encoding='utf-8')
                return {'path': str(path), 'bytes': 17, 'sha256': 'fixture', 'route': 'proxy'}
            api = types.ModuleType('astrbot.api')
            api.FunctionTool = lambda **kw: kw
            api.ToolSet = lambda: types.SimpleNamespace(add_tool=lambda t: None)
            first = types.SimpleNamespace(completion_text='', to_openai_tool_calls=lambda: [{
                'id': 'download1', 'type': 'function', 'function': {'name': 'workgroup_download',
                'arguments': json.dumps({'url': 'https://example.com/test', 'filename': 'test.md'})}}])
            final = types.SimpleNamespace(completion_text='完成', to_openai_tool_calls=lambda: [])
            replies = iter([first, final] if call else [final])
            async def text_chat(**kw):
                self.assertIn('func_tool', kw)
                return next(replies)
            async def provider_at(*args):
                return types.SimpleNamespace(text_chat=text_chat)
            owner = types.SimpleNamespace(state={'mode': 'work', 'native_execution_enabled': enabled},
                provider_at=provider_at, save=lambda: None)
            scope = dict(asyncio=asyncio, uuid=uuid, time=time, json=json, download_file=download,
                StarTools=types.SimpleNamespace(get_data_dir=lambda _: root),
                atomic_json=lambda p, d: p.write_text(json.dumps(d), encoding='utf-8'))
            exec(compile(ast.Module(body=[method], type_ignores=[]), 'main.py', 'exec'), scope)
            with patch.dict(sys.modules, {'astrbot': types.ModuleType('astrbot'), 'astrbot.api': api}):
                result = await scope['run_worker_download'](owner, 'group', '1000000003', 'xiaofeiyu', '', 'download', 'system')
            evidence = json.loads(next(root.rglob('execution-evidence.json')).read_text())
            return result, downloads, evidence

    async def test_model_call_downloads_and_records_agent_identity(self):
        result, calls, evidence = await self.exercise()
        self.assertEqual(calls, ['test.md'])
        self.assertEqual(evidence['tools'][0]['result']['agent_id'], 'xiaofeiyu')
        self.assertEqual(evidence['files'], 1)
        self.assertIn('"status": "success"', result)

    async def test_text_only_completion_is_blocked(self):
        result, calls, evidence = await self.exercise(call=False)
        self.assertTrue(result.startswith('状态：BLOCKED'))
        self.assertEqual(calls, [])
        self.assertEqual(evidence['status'], '受阻')

    async def test_disabled_execution_cannot_download(self):
        result, calls, evidence = await self.exercise(enabled=False)
        self.assertTrue(result.startswith('状态：BLOCKED'))
        self.assertEqual(calls, [])
        self.assertEqual(evidence['tools'][0]['result']['status'], 'BLOCKED')

    async def test_explicit_download_executes_without_model_decision(self):
        tree = ast.parse(Path('main.py').read_text(encoding='utf-8'))
        method = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)
                      and n.name == 'run_worker_download_direct')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def download(url, folder, filename, mode, proxy):
                path = folder / filename
                path.write_text('real test fixture', encoding='utf-8')
                return {'path': str(path), 'bytes': 17, 'sha256': 'fixture',
                        'route': 'proxy', 'proxy_url': 'http://127.0.0.1:7900'}
            owner = types.SimpleNamespace(
                state={'mode': 'work', 'paused': False, 'native_execution_enabled': True,
                       'download_settings': {'mode': 'detect'}, 'native_runs': []},
                save=lambda: None)
            scope = dict(asyncio=asyncio, uuid=uuid, time=time, json=json, re=re,
                         download_file=download,
                         StarTools=types.SimpleNamespace(get_data_dir=lambda _: root),
                         atomic_json=lambda p, d: p.write_text(json.dumps(d), encoding='utf-8'))
            exec(compile(ast.Module(body=[method], type_ignores=[]), 'main.py', 'exec'), scope)
            result = await scope['run_worker_download_direct'](
                owner, '1000000003', 'xiaofeiyu3',
                '亲自调用 workgroup_download 下载 https://example.com/test，保存为 R4-xiaofeiyu3.md；只下载')
            evidence = json.loads(next(root.rglob('execution-evidence.json')).read_text())
            self.assertIn('状态：SUCCESS', result)
            self.assertEqual(evidence['bot_id'], '1000000003')
            self.assertEqual(evidence['agent_id'], 'xiaofeiyu3')
            self.assertEqual(evidence['tools'][0]['result']['proxy_url'], 'http://127.0.0.1:7900')
            self.assertTrue(next(root.rglob('R4-xiaofeiyu3.md')).is_file())

    async def test_fixed_assignment_retry_does_not_change_identity(self):
        tree = ast.parse(Path('main.py').read_text(encoding='utf-8'))
        method = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)
                      and n.name == 'retry')
        dispatched = []
        async def dispatch(event, task, index):
            dispatched.append((task['steps'][index]['bot_id'], task['steps'][index]['agent_id']))
        owner = types.SimpleNamespace(
            cfg={'max_attempts': 3}, state={'effort_levels': {}},
            roster={'1000000003': {}},
            available_roster=lambda: {'1000000001': {}, '1000000003': {}},
            agent_effort_for=lambda bot, agent: 50,
            log=lambda *a, **k: None, finish=lambda task: None, dispatch=dispatch)
        task = {'id': 'wg-test', 'steps': [{'work': 'download', 'bot_id': '1000000003',
                 'agent_id': 'xiaofeiyu2', 'fixed_assignment': True, 'status': 'running',
                 'attempt': 1, 'tried': []}]}
        scope = dict(AstrMessageEvent=type('AstrMessageEvent', (), {}),
                     choose_bot=lambda *a, **k: '1000000001',
                     ensure_workbench=lambda s: {'scenes': {}})
        exec(compile(ast.Module(body=[method], type_ignores=[]), 'main.py', 'exec'), scope)
        await scope['retry'](owner, None, task, 0, 'timeout')
        self.assertEqual(dispatched, [('1000000003', 'xiaofeiyu2')])
