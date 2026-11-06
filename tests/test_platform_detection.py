import ast
import asyncio
import inspect
import re
import time
import unittest
from pathlib import Path
from types import SimpleNamespace


class PlatformDetectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_dynamic_cqhttp_client_is_not_awaited(self):
        tree = ast.parse(Path('main.py').read_text(encoding='utf-8'))
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'WorkGroupPlugin')
        method = next(n for n in cls.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'platform_accounts')
        scope = dict(asyncio=asyncio, inspect=inspect, re=re, time=time, Any=object)
        exec(compile(ast.Module(body=[method], type_ignores=[]), 'main.py', 'exec'), scope)

        class CQHttp:
            _wsr_api_clients = {'2712755141': object()}
            _wsr_event_clients = set()

            def __getattr__(self, key):
                async def api(**kwargs):
                    raise RuntimeError('Dynamic API is not an attribute value')
                return api

        client = CQHttp()
        adapter = SimpleNamespace(meta=lambda: SimpleNamespace(name='aiocqhttp'), get_client=lambda: client)
        plugin = SimpleNamespace(context=SimpleNamespace(platform_manager=SimpleNamespace(get_insts=lambda: [adapter])),
                                 _platform_cache_at=0, local_bot_id=lambda: '2712755141', roster={'2712755141': {}})
        result = await scope['platform_accounts'](plugin, force=True)
        self.assertTrue(result['2712755141']['online'])
        self.assertEqual(result['2712755141']['platform'], 'aiocqhttp')
