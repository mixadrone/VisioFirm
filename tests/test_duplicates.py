"""Duplicate cleanup tests using isolated project files and SQLite databases."""
import importlib.util
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
from PIL import Image, PngImagePlugin

spec = importlib.util.spec_from_file_location("duplicate_service", Path(__file__).parents[1] / "visiofirm/duplicates.py")
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


class DuplicateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "images").mkdir()
        with closing(sqlite3.connect(self.root / "config.db")) as conn:
            conn.executescript("""
            CREATE TABLE Images(image_id INTEGER PRIMARY KEY, absolute_path TEXT UNIQUE, width INTEGER, height INTEGER);
            CREATE TABLE Annotations(annotation_id INTEGER PRIMARY KEY, image_id INTEGER, value TEXT);
            CREATE TABLE Preannotations(preannotation_id INTEGER PRIMARY KEY, image_id INTEGER, value TEXT);
            CREATE TABLE ReviewedImages(image_id INTEGER PRIMARY KEY, reviewed_at TEXT);
            """)

    def sql(self, statement, args=()):
        with closing(sqlite3.connect(self.root / "config.db")) as conn:
            rows = conn.execute(statement, args).fetchall()
            conn.commit()
            return rows

    def add(self, image_id, color=(10,20,30,255), size=(8,8), name=None):
        path = self.root / "images" / (name or f"source_x{image_id * 100}_y0.png")
        info = PngImagePlugin.PngInfo()
        info.add_text("description", str(image_id))
        Image.new("RGBA", size, color).save(path, pnginfo=info)
        self.sql("INSERT INTO Images VALUES(?,?,?,?)", (image_id,str(path),*size))
        return path

    def group(self):
        group = service.scan_duplicates(self.root)["groups"][0]
        group["remove_ids"] = [m["image_id"] for m in group["members"] if m["image_id"] != group["keep_id"]]
        return group

    def test_source_names_ignore_coordinates_not_content(self):
        base = "DJI_20260916130748_0005_V"
        self.add(1,name=base+".png")
        self.add(2,color=(20,20,30,255),name=base+"_x2560_y1280.png")
        self.add(3,size=(9,8),name=base+"_x0_y0.png")
        self.add(4,name="another_source_x0_y0.png")
        result=service.scan_duplicates(self.root)
        self.assertEqual(len(result["groups"]),1)
        group=result["groups"][0]
        self.assertEqual(group["source_name"],base)
        self.assertEqual([m["image_id"] for m in group["members"]],[1,2,3])
        group["remove_ids"]=[2,3]
        self.assertEqual(service.clean_duplicates(self.root,[group])["deleted"],[2,3])

    def test_suffix_is_anchored_and_extensions_are_ignored(self):
        self.assertEqual(service.source_name("DJI_20260916130748_0005_V_x2560_y1280.jpg"),
                         "DJI_20260916130748_0005_V")
        self.assertEqual(service.source_name("DJI_20260916130748_0005_V.jpg"),
                         "DJI_20260916130748_0005_V")
        self.assertEqual(service.source_name("a_x0_y0_edited.jpg"),"a_x0_y0_edited")
        self.assertEqual(service.source_name("a_x12.jpg"),"a_x12")
        self.assertEqual(service.source_name("a_X12_Y34.PNG"),"a")
        self.add(1,name="source_x0_y0.png")
        self.add(2,name="SOURCE_x10_y20.PNG")
        self.assertEqual(len(service.scan_duplicates(self.root)["groups"]),1)

    def test_recommendation_conflict_confirmation_and_cleanup(self):
        self.add(1); self.add(2); self.add(3)
        self.sql("INSERT INTO Annotations VALUES(1,2,'box')")
        self.sql("INSERT INTO ReviewedImages VALUES(3,'now')")
        group=self.group()
        self.assertEqual(group["keep_id"],3); self.assertTrue(group["conflict"])
        self.assertEqual(len(service.clean_duplicates(self.root,[group])["skipped"]),1)
        result=service.clean_duplicates(self.root,[group],True)
        self.assertEqual(result["deleted"],[1,2])
        self.assertEqual(self.sql("SELECT image_id FROM Images"),[(3,)])
        self.assertEqual(self.sql("SELECT * FROM Annotations"),[])
        self.assertEqual(len(service.clean_duplicates(self.root,[group],True)["skipped"]),1)

    def test_equal_priority_uses_lowest_id(self):
        self.add(1); self.add(2)
        self.sql("INSERT INTO ReviewedImages VALUES(1,'now')")
        self.sql("INSERT INTO ReviewedImages VALUES(2,'now')")
        self.sql("INSERT INTO Annotations VALUES(1,2,'box')")
        self.assertEqual(self.group()["keep_id"],1)

    def test_stale_annotations_and_file(self):
        self.add(1); second=self.add(2)
        group=self.group(); self.sql("INSERT INTO Preannotations VALUES(1,2,'prediction')")
        self.assertEqual(len(service.clean_duplicates(self.root,[group])["skipped"]),1)
        group=self.group(); Image.new("RGB",(8,8),'red').save(second)
        self.assertEqual(len(service.clean_duplicates(self.root,[group])["skipped"]),1)

    def test_tampering_and_all_copies_rejected(self):
        self.add(1);self.add(2)
        group=self.group();group["remove_ids"]=[1,2]
        self.assertEqual(len(service.clean_duplicates(self.root,[group])["skipped"]),1)
        group=self.group();group["members"][0]["image_id"]=999
        self.assertFalse(service.clean_duplicates(self.root,[group])["deleted"])
        group=self.group();group["members"][0]["state"]='forged'
        self.assertFalse(service.clean_duplicates(self.root,[group])["deleted"])

    def test_missing_and_external_paths(self):
        path=self.add(1);path.unlink()
        self.sql("INSERT INTO Images VALUES(3,?,8,8)",(str(self.root/'outside.png'),))
        result=service.scan_duplicates(self.root)
        self.assertEqual(len(result["skipped"]),2)
        self.assertEqual(result["groups"],[])

    def test_database_failure_restores_files_and_records(self):
        self.add(1);path=self.add(2);group=self.group()
        self.sql("CREATE TRIGGER fail_delete BEFORE DELETE ON Images BEGIN SELECT RAISE(ABORT,'test failure'); END")
        result=service.clean_duplicates(self.root,[group])
        self.assertEqual(len(result["failed"]),1)
        self.assertTrue(path.exists())
        self.assertEqual(len(self.sql("SELECT * FROM Images")),2)
        self.assertEqual(list((self.root/'.duplicate-cleanup').iterdir()),[])

    def test_file_lock_failure_keeps_database(self):
        self.add(1);self.add(2);group=self.group()
        with patch.object(Path,'rename',side_effect=PermissionError('locked')):
            result=service.clean_duplicates(self.root,[group])
        self.assertEqual(len(result["failed"]),1)
        self.assertEqual(len(self.sql("SELECT * FROM Images")),2)

    def test_post_commit_unlink_failure_is_reported(self):
        self.add(1);self.add(2);group=self.group()
        with patch.object(Path,'unlink',side_effect=PermissionError('locked')):
            result=service.clean_duplicates(self.root,[group])
        self.assertEqual(result["deleted"],[2]);self.assertEqual(len(result["warnings"]),1)
        self.assertEqual(len(self.sql("SELECT * FROM Images")),1)


if __name__ == '__main__':
    unittest.main()
