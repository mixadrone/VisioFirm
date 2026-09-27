"""Approval regression tests using real SQLite and isolated route/model methods.

Load the relevant definitions without importing unrelated ML model runtimes.
"""
import ast
import asyncio
from contextlib import closing, nullcontext
import importlib.util
import logging
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("review_status", ROOT / "visiofirm/review_status.py")
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


def definitions(path, names, namespace, class_name=None):
    tree = ast.parse((ROOT / path).read_text())
    if class_name:
        node = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == class_name)
        node.body = [n for n in node.body if isinstance(n, ast.FunctionDef) and n.name in names]
        nodes = [node]
    else:
        nodes = [n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name in names]
        for node in nodes:
            node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project_dir = self.root / 'demo'
        self.project_dir.mkdir()
        self.ns = dict(json=json, sqlite3=sqlite3, closing=closing, os=os, logger=logging.getLogger('test'),
                       ANNOTATED_SQL=review.ANNOTATED_SQL, APPROVED_SQL=review.APPROVED_SQL, initialize_review_status=review.initialize_review_status)
        definitions('visiofirm/models/project.py', {'__init__', '_initialize_db', 'get_setup_type',
                    'get_images_with_status', 'get_annotated_image_count', 'get_annotations'}, self.ns, 'Project')
        self.project = self.ns['Project']('demo', '', 'Bounding Box', str(self.project_dir))
        self.db = self.project.db_path
        self.sql("INSERT INTO Images(image_id, absolute_path, width, height) VALUES(1, ?, 100, 100)",
                 (str(self.project_dir / 'images' / 'one.jpg'),))
        self.sql("INSERT INTO Classes VALUES('object')")
        self.labels = [dict(category_name='object', bbox=[10, 20, 30, 40], rotation=0)]
        self.ns.update(Request=object, User=object, Depends=lambda x: None,
                       get_current_user_from_cookie=lambda: None, HTTPException=HTTPException,
                       PROJECTS_FOLDER=str(self.root), set_image_approval=review.set_image_approval,
                       secure_filename=lambda filename: filename,  # Fixtures use safe ASCII names.
                       tqdm=lambda **kw: nullcontext(SimpleNamespace(update=lambda *a: None)))
        definitions('visiofirm/routes/annotation.py', {'unapprove_image', 'save_annotations', 'get_annotations'}, self.ns)
        self.tracker = SimpleNamespace(**{name: lambda *a, **kw: None for name in
                                         ('log_step', 'log_substep', 'log_error')})

    def sql(self, query, args=()):
        with closing(sqlite3.connect(self.db)) as conn, conn:
            return conn.execute(query, args).fetchall()

    def call(self, name, **data):
        async def body():
            return data
        request = SimpleNamespace(json=body, app=SimpleNamespace(tracker=self.tracker))
        return asyncio.run(self.ns[name](request, SimpleNamespace(id=1)))

    def save(self, **extra):
        return self.call('save_annotations', project='demo', image='one.jpg', annotations=self.labels, **extra)

    def unapprove(self):
        return self.call('unapprove_image', project='demo', image='one.jpg')

    def status(self):
        return bool(self.project.get_images_with_status()[0][1])

    def run_preannotation(self, results, setup_type='Bounding Box'):
        self.ns.update(
            Image=SimpleNamespace(open=lambda path: SimpleNamespace(convert=lambda mode: object())),
            torch=SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)),
            gc=SimpleNamespace(collect=lambda: None),
            tqdm=lambda **kw: nullcontext(SimpleNamespace(update=lambda *a: None, set_postfix=lambda *a: None)))
        definitions('visiofirm/utils/VFPreAnnotator.py', {'run_inferences'}, self.ns, 'PreAnnotator')
        processor = self.ns['PreAnnotator']()
        processor.setup_type = setup_type
        processor.model_type = 'grounding_dino_tiny'
        processor.images = self.sql('SELECT image_id, absolute_path FROM Images')
        processor.classes = ['object']
        processor.classes_str = 'object'
        processor.box_threshold = 0.2
        processor.progress_callback = None
        calls = []
        def infer(**kwargs):
            calls.append(kwargs)
            return results
        processor.image_processor = SimpleNamespace(process_image=infer)
        with closing(sqlite3.connect(self.db)) as conn:
            processor.conn = conn
            processor.run_inferences()
        return calls

    def test_preannotation_processes_unconfirmed_images_with_or_without_detections(self):
        for setup in ['Bounding Box', 'Classification', 'Segmentation']:
            for detections in [False, True] if setup != 'Segmentation' else [False]:
                with self.subTest(setup=setup, detections=detections):
                    self.sql('DELETE FROM Preannotations')
                    self.sql('DELETE FROM UnreviewedImages')
                    self.sql('DELETE FROM ReviewedImages')
                    results = dict(boxes=[[1, 2, 11, 12]] if detections else [],
                                   labels=['object'] if detections else [], scores=[0.9] if detections else [])
                    self.assertEqual(len(self.run_preannotation(results, setup)), 1)
                    self.assertFalse(self.status())
                    self.assertEqual(self.sql('SELECT * FROM ReviewedImages'), [])
                    self.assertEqual(len(self.sql('SELECT * FROM Preannotations')), int(detections))

    def test_preannotation_never_processes_confirmed_empty_images(self):
        self.sql("INSERT INTO ReviewedImages(image_id, reviewed_at, user_id) VALUES(1, '2026-09-01', 42)")
        before = self.sql('SELECT * FROM ReviewedImages')
        for setup in ['Bounding Box', 'Oriented Bounding Box', 'Segmentation', 'Classification']:
            with self.subTest(setup=setup):
                self.assertEqual(self.run_preannotation({}, setup), [])
                self.assertEqual(self.sql('SELECT * FROM ReviewedImages'), before)
                self.assertEqual(self.sql('SELECT * FROM UnreviewedImages'), [])
                self.assertEqual(self.sql('SELECT * FROM Preannotations'), [])
                self.assertTrue(self.status())

    def test_explicit_unapprove_makes_empty_image_eligible(self):
        self.sql('INSERT INTO ReviewedImages(image_id) VALUES(1)')
        self.unapprove()
        calls = self.run_preannotation(dict(boxes=[[1, 2, 11, 12]], labels=['object'], scores=[0.9]))
        self.assertEqual(len(calls), 1)
        self.assertFalse(self.status())
        self.assertEqual(len(self.sql('SELECT * FROM Preannotations')), 1)

    def test_preannotation_skips_existing_labels_without_changing_approval(self):
        self.save()
        self.assertEqual(self.run_preannotation({}), [])
        self.assertTrue(self.status())
        self.sql('DELETE FROM Annotations')
        self.sql("INSERT INTO Preannotations(image_id, type, class_name, confidence) VALUES(1, 'rect', 'object', 0.9)")
        self.assertEqual(self.run_preannotation({}), [])
        self.assertFalse(self.status())
        self.assertEqual(len(self.sql('SELECT * FROM ReviewedImages')), 1)

    def test_preannotation_rolls_back_partial_labels_on_failure(self):
        self.sql("CREATE TRIGGER fail_second_label BEFORE INSERT ON Preannotations WHEN NEW.x = 20 BEGIN SELECT RAISE(ABORT, 'failure'); END")
        self.run_preannotation(dict(boxes=[[1, 2, 11, 12], [20, 2, 30, 12]], labels=['object', 'object'], scores=[0.9, 0.8]))
        self.assertFalse(self.status())
        self.assertEqual(self.sql('SELECT * FROM UnreviewedImages'), [])
        self.assertEqual(self.sql('SELECT * FROM Preannotations'), [])

    def test_predictions_override_approval_without_removing_review(self):
        for has_labels in (False, True):
            with self.subTest(has_labels=has_labels):
                self.labels = [dict(category_name='object', bbox=[1, 2, 10, 20])] if has_labels else []
                self.save()
                before = self.sql('SELECT * FROM ReviewedImages')
                self.sql("INSERT INTO Preannotations(image_id, type, class_name, confidence) VALUES(1, 'rect', 'object', 0.9)")
                self.assertFalse(self.status())
                self.assertEqual(self.project.get_annotated_image_count(), 0)
                self.assertEqual(self.sql('SELECT * FROM ReviewedImages'), before)
                self.sql('DELETE FROM Preannotations')
                self.assertTrue(self.status())
                self.assertEqual(self.project.get_annotated_image_count(), 1)

    def test_approve_resolves_pending_predictions(self):
        self.save()
        self.sql("INSERT INTO Preannotations(image_id, type, class_name, confidence) VALUES(1, 'rect', 'object', 0.9)")
        self.assertFalse(self.status())
        self.save(approve=True)
        self.assertTrue(self.status())
        self.assertEqual(self.sql('SELECT * FROM Preannotations'), [])

    def test_existing_database_migration_preserves_status(self):
        self.save()
        self.sql('DROP TABLE UnreviewedImages')
        self.project._initialize_db()
        self.assertTrue(self.status())
        self.assertEqual(self.project.get_annotated_image_count(), 1)
        self.assertEqual(self.sql('SELECT * FROM UnreviewedImages'), [])

    def test_unapprove_preserves_all_labels_and_survives_reopen(self):
        self.save()
        self.sql("INSERT INTO Preannotations(image_id, type, class_name, confidence) VALUES(1, 'rect', 'object', 0.8)")
        before = [self.sql('SELECT * FROM ' + table) for table in ('Annotations', 'Preannotations')]
        result = self.unapprove()
        self.assertTrue(result['preannotated'])
        self.assertFalse(self.status())
        self.assertEqual(self.project.get_annotated_image_count(), 0)
        self.assertEqual(self.sql('SELECT * FROM ReviewedImages'), [])
        self.assertEqual(before, [self.sql('SELECT * FROM ' + table) for table in ('Annotations', 'Preannotations')])
        self.project._initialize_db()
        self.assertFalse(self.status())
        self.unapprove()
        self.assertEqual(self.sql('SELECT * FROM UnreviewedImages'), [(1,)])

    def test_empty_reviewed_image_can_be_unapproved_and_approved(self):
        self.labels = []
        self.save()
        self.assertTrue(self.status())
        self.assertEqual(self.project.get_annotated_image_count(), 1)
        self.unapprove()
        self.assertFalse(self.status())
        self.save(approve=True)
        self.assertTrue(self.status())

    def test_autosave_persists_edits_without_approval_then_explicit_approve_restores(self):
        self.save()
        self.unapprove()
        self.labels[0]['bbox'][0] = 15
        self.save(approve=False)
        self.assertFalse(self.status())
        self.assertEqual(self.sql('SELECT x FROM Annotations'), [(15.0,)])
        self.save(approve=True)
        self.assertTrue(self.status())
        self.assertEqual(self.sql('SELECT * FROM UnreviewedImages'), [])

    def test_save_without_approval_preserves_unconfirmed_and_confirmed_states(self):
        self.save(approve=False)
        self.assertFalse(self.status())
        self.save()
        self.save(approve=False)
        self.assertTrue(self.status())

    def test_loading_returns_explicit_unreviewed_state_and_retained_geometry(self):
        self.save()
        self.unapprove()
        request = SimpleNamespace(app=SimpleNamespace(tracker=self.tracker))
        result = asyncio.run(self.ns['get_annotations'](
            request=request, project_name='demo', image_path='one.jpg', current_user=SimpleNamespace(id=1)))
        self.assertTrue(result['unreviewed'])
        self.assertFalse(result['reviewed'])
        self.assertEqual(result['annotations'][0]['bbox'], [10, 20, 30, 40])

    def test_legacy_annotation_without_review_remains_annotated(self):
        self.save()
        self.sql('DELETE FROM ReviewedImages')
        self.assertTrue(self.status())
        self.unapprove()
        self.assertFalse(self.status())

    def test_transaction_failure_restores_review_and_geometry(self):
        self.save()
        before = self.sql('SELECT * FROM Annotations')
        self.sql("CREATE TRIGGER fail_unapprove BEFORE INSERT ON UnreviewedImages BEGIN SELECT RAISE(ABORT, 'failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.unapprove()
        self.assertTrue(self.status())
        self.assertEqual(len(self.sql('SELECT * FROM ReviewedImages')), 1)
        self.assertEqual(before, self.sql('SELECT * FROM Annotations'))

    def test_missing_image_and_path_traversal_do_not_change_state(self):
        self.save()
        for data, status in [({'project': 'demo', 'image': 'absent.jpg'}, 404),
                             ({'project': '..', 'image': 'one.jpg'}, 400),
                             ({'project': 'demo', 'image': '../one.jpg'}, 400),
                             ({'project': 'missing', 'image': 'one.jpg'}, 404)]:
            with self.assertRaises(HTTPException) as error:
                self.call('unapprove_image', **data)
            self.assertEqual(error.exception.status_code, status)
        self.assertTrue(self.status())


if __name__ == '__main__':
    unittest.main()
