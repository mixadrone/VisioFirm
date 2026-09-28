"""Geometry and validation checks for point-prompted Magic annotations."""

import ast
from pathlib import Path
from threading import Lock
from types import SimpleNamespace
import tempfile
import unittest

import cv2
import numpy as np
import torch
from PIL import Image


class FakeTensor:
    def __init__(self, mask):
        self.mask = mask

    def cpu(self):
        return self

    def numpy(self):
        return self.mask


class FakeModel:
    def __init__(self, mask):
        self.mask = mask

    def predict(self, *args, **kwargs):
        return [SimpleNamespace(masks=SimpleNamespace(data=[FakeTensor(self.mask)]))]


class MagicSegmentTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.image_path = Path(temp.name) / 'image.png'
        Image.new('RGB', (32, 32)).save(self.image_path)
        source = Path(__file__).resolve().parents[1] / 'visiofirm/magic_segment.py'
        tree = ast.parse(source.read_text(encoding='utf-8'))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'segment_image')
        self.namespace = {
            'Image': Image, 'Path': Path, 'np': np, 'cv2': cv2, 'torch': torch,
            'MAGIC_MODELS': {'sam2.1_t': 'sam2.1_t.pt'},
            '_model_locks': {'sam2.1_t': Lock()}, '_models': {},
            'get_or_download_model': lambda _: 'unused',
        }
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), self.namespace)

    def test_box_and_polygon_follow_the_mask(self):
        mask = np.zeros((32, 32), dtype=np.float32)
        mask[5:15, 6:18] = 1
        self.namespace['_models']['sam2.1_t'] = FakeModel(mask)
        segment = self.namespace['segment_image']

        box = segment(self.image_path, (10, 10), 'sam2.1_t', 'Bounding Box')
        self.assertEqual((box['type'], box['x'], box['y'], box['width'], box['height']),
                         ('rect', 6, 5, 12, 10))
        oriented = segment(self.image_path, (10, 10), 'sam2.1_t', 'Oriented Bounding Box')
        self.assertEqual((oriented['type'], oriented['rotation']), ('obbox', 0))
        polygon = segment(self.image_path, (10, 10), 'sam2.1_t', 'Segmentation')
        self.assertEqual(polygon['type'], 'polygon')
        self.assertGreaterEqual(len(polygon['points']), 3)

    def test_invalid_point_and_empty_mask(self):
        self.namespace['_models']['sam2.1_t'] = FakeModel(np.zeros((32, 32), dtype=np.float32))
        segment = self.namespace['segment_image']
        with self.assertRaises(ValueError):
            segment(self.image_path, (32, 10), 'sam2.1_t', 'Bounding Box')
        with self.assertRaises(ValueError):
            segment(self.image_path, (10, 10), 'unknown', 'Bounding Box')
        self.assertIsNone(segment(self.image_path, (10, 10), 'sam2.1_t', 'Bounding Box'))


if __name__ == '__main__':
    unittest.main()
