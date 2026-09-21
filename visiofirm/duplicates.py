"""Source filename duplicate discovery and transactional project cleanup."""
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path
from urllib.parse import quote


_SIGNING_KEY = secrets.token_bytes(32)


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def source_name(filename):
    """Remove only the terminal tile coordinate suffix and file extension."""
    return re.sub(r"_x[0-9]+_y[0-9]+$", "", Path(filename).stem, flags=re.IGNORECASE)


def _file_hash(path):
    # Content is fingerprinted for stale-scan protection, never for grouping.
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _path(root, value):
    path = Path(value).resolve()
    if not path.is_relative_to((root / "images").resolve()):
        raise ValueError("Image path is outside this project")
    return path


def _record(conn, root, image_id):
    row = conn.execute("SELECT * FROM Images WHERE image_id = ?", (image_id,)).fetchone()
    if row is None:
        raise ValueError("Image no longer exists; scan again")
    path = _path(root, row[1])
    stat = path.stat()
    content_hash = _file_hash(path)
    related = {}
    for table in ("Annotations", "Preannotations", "ReviewedImages"):
        related[table] = conn.execute(f"SELECT * FROM {table} WHERE image_id = ? ORDER BY rowid", (image_id,)).fetchall()
    state = _digest([list(row), str(path), stat.st_size, stat.st_mtime_ns, content_hash, related])
    return {"image_id": image_id, "name": path.name, "width": row[2], "height": row[3],
            "bytes": stat.st_size, "reviewed": bool(related["ReviewedImages"]),
            "annotations": len(related["Annotations"]), "preannotations": len(related["Preannotations"]),
            "state": state, "source_name": source_name(path.name),
            "url": "/projects/" + quote(root.name) + "/images/" + quote(path.relative_to(root / "images").as_posix())}


def _token(root, members):
    payload = json.dumps([str(root), sorted((m["image_id"], m["state"]) for m in members)]).encode()
    return hmac.new(_SIGNING_KEY, payload, hashlib.sha256).hexdigest()


def scan_duplicates(project_path):
    root = Path(project_path).resolve()
    buckets, skipped = {}, []
    with closing(sqlite3.connect(root / "config.db")) as conn:
        ids = [row[0] for row in conn.execute("SELECT image_id FROM Images ORDER BY image_id")]
        for image_id in ids:
            try:
                item = _record(conn, root, image_id)
                buckets.setdefault(item["source_name"].casefold(), []).append(item)
            except (OSError, ValueError) as exc:
                skipped.append({"image_id": image_id, "reason": str(exc)})
    groups = []
    for members in buckets.values():
        if len(members) < 2:
            continue
        recommended = min(members, key=lambda m: (
            0 if m["reviewed"] else 1 if m["annotations"] else 2 if m["preannotations"] else 3,
            m["image_id"]))
        conflict = sum(bool(m["reviewed"] or m["annotations"]) for m in members) > 1
        groups.append({"source_name": members[0]["source_name"], "members": members, "token": _token(root, members),
                       "keep_id": recommended["image_id"], "conflict": conflict})
    return {"groups": groups, "skipped": skipped, "scanned": len(ids)}


def clean_duplicates(project_path, groups, confirm_loss=False):
    root = Path(project_path).resolve()
    result = {"deleted": [], "skipped": [], "failed": [], "warnings": []}
    seen = set()
    for group in groups:
        staged = []
        committed = False
        ids = []
        try:
            members = group["members"]
            ids = [m["image_id"] for m in members]
            keep = group["keep_id"]
            remove = group["remove_ids"]
            if (not ids or any(type(i) is not int for i in ids) or len(set(ids)) != len(ids)
                    or keep not in ids or not remove or len(set(remove)) != len(remove)
                    or set(remove) != set(ids) - {keep} or seen.intersection(ids)):
                raise ValueError("Invalid group selection")
            seen.update(ids)
            if not hmac.compare_digest(_token(root, members), group["token"]):
                raise ValueError("Scan expired or changed; scan again")
            with closing(sqlite3.connect(root / "config.db", timeout=10)) as conn:
                try:
                    conn.execute("BEGIN IMMEDIATE")
                    current = [_record(conn, root, i) for i in ids]
                    if _token(root, current) != group["token"]:
                        raise ValueError("Files or annotations changed; scan again")
                    if any(m["image_id"] in remove and (m["reviewed"] or m["annotations"]) for m in current) and not confirm_loss:
                        raise ValueError("Confirm removal of reviewed images or manual annotations")
                    paths = {i: _path(root, conn.execute("SELECT absolute_path FROM Images WHERE image_id=?", (i,)).fetchone()[0]) for i in ids}
                    if len(set(paths.values())) != len(paths):
                        raise ValueError("Multiple records reference the same file")
                    if len({m["source_name"].casefold() for m in current}) != 1:
                        raise ValueError("Images do not share the same source filename")
                    staging = root / ".duplicate-cleanup"
                    staging.mkdir(exist_ok=True)
                    if staging.is_symlink() or not staging.resolve().is_relative_to(root):
                        raise ValueError("Invalid cleanup staging directory")
                    for image_id in remove:
                        original = paths[image_id]
                        temporary = staging / (uuid.uuid4().hex + original.suffix)
                        original.rename(temporary)
                        staged.append((original, temporary))
                        for table in ("Annotations", "Preannotations", "ReviewedImages", "Images"):
                            conn.execute(f"DELETE FROM {table} WHERE image_id=?", (image_id,))
                    conn.commit()
                    committed = True
                    result["deleted"].extend(remove)
                except Exception:
                    conn.rollback()
                    raise
            for _, temporary in staged:
                try:
                    temporary.unlink()
                except OSError as exc:
                    result["warnings"].append(f"Removed from project, but temporary file remains: {temporary.name}: {exc}")
        except Exception as exc:
            if not committed:
                for original, temporary in reversed(staged):
                    try:
                        temporary.rename(original)
                    except OSError as restore_error:
                        result["warnings"].append(f"Restore failed for {original.name}; file retained at {temporary}: {restore_error}")
            category = "skipped" if isinstance(exc, (ValueError, KeyError, TypeError)) else "failed"
            result[category].append({"image_ids": ids, "reason": str(exc)})
    return result
