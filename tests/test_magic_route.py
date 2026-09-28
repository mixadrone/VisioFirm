"""Route checks for Magic image ownership and point bounds."""

import ast
import asyncio
from contextlib import closing
import logging
import math
from pathlib import Path
import sqlite3
import tempfile
import unittest

from fastapi import HTTPException
from pydantic import BaseModel


class MagicRouteTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        project_dir = root / 'demo'
        image_dir = project_dir / 'images'
        image_dir.mkdir(parents=True)
        image_path = image_dir / 'one.png'
        image_path.touch()
        db_path = project_dir / 'config.db'
        with closing(sqlite3.connect(db_path)) as conn, conn:
            conn.execute('CREATE TABLE Images (image_id INTEGER PRIMARY KEY, absolute_path TEXT, width INTEGER, height INTEGER)')
            conn.execute('INSERT INTO Images VALUES (1, ?, 32, 32)', (str(image_path),))
            conn.execute('INSERT INTO Images VALUES (2, ?, 32, 32)', (str(root / 'elsewhere.png'),))

        class Project:
            def __init__(self, *args):
                self.db_path = str(db_path)

            def get_setup_type(self):
                return 'Bounding Box'

        async def run_in_threadpool(fn, *args):
            return fn(*args)

        source = Path(__file__).resolve().parents[1] / 'visiofirm/routes/annotation.py'
        tree = ast.parse(source.read_text(encoding='utf-8'))
        nodes = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'MagicSegmentRequest'
                 or isinstance(node, ast.AsyncFunctionDef) and node.name == 'magic_segment']
        for node in nodes:
            node.decorator_list = []
        self.namespace = {
            'BaseModel': BaseModel, 'User': object, 'Depends': lambda _: None,
            'get_current_user_from_cookie': lambda: None,
            'Path': Path, 'PROJECTS_FOLDER': str(root), 'sqlite3': sqlite3,
            'closing': closing, 'math': math, 'HTTPException': HTTPException,
            'Project': Project, 'MAGIC_MODELS': {'sam2.1_t': 'sam2.1_t.pt'},
            'run_in_threadpool': run_in_threadpool,
            'segment_image': lambda *args: {'type': 'rect'},
            'logger': logging.getLogger('magic-route-test'),
        }
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), self.namespace)

    def call(self, **overrides):
        data = dict(project_name='demo', image_id=1, model='sam2.1_t', x=10, y=10)
        data.update(overrides)
        payload = self.namespace['MagicSegmentRequest'](**data)
        return asyncio.run(self.namespace['magic_segment'](payload, None))

    def test_valid_image_returns_annotation(self):
        self.assertEqual(self.call()['annotation'], {'type': 'rect'})

    def test_rejects_missing_foreign_and_out_of_bounds_images(self):
        for data, status in [({'image_id': 99}, 404), ({'image_id': 2}, 404),
                             ({'x': 32}, 400), ({'model': 'unknown'}, 400)]:
            with self.subTest(data=data), self.assertRaises(HTTPException) as error:
                self.call(**data)
            self.assertEqual(error.exception.status_code, status)


if __name__ == '__main__':
    unittest.main()
