# visiofirm/routes/dashboard.py
from fastapi import APIRouter, Request, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from visiofirm.security import get_current_user_from_cookie, User
from visiofirm.models import Project
from visiofirm.config import PROJECTS_FOLDER, VALID_IMAGE_EXTENSIONS, VALID_VIDEO_EXTENSIONS
from werkzeug.utils import secure_filename
import os
import sqlite3
from contextlib import closing
import logging
from pydantic import BaseModel, StrictBool, StrictInt
from typing import Optional
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard")
module_dir = os.path.dirname(__file__)
templates_dir = os.path.join(module_dir, "..", "templates")
templates = Jinja2Templates(directory=templates_dir)

async def get_current_user_optional(request: Request) -> Optional[User]:
    try:
        return await get_current_user_from_cookie(request)
    except HTTPException:
        return None

@router.get("/", response_class=HTMLResponse)
async def index(request: Request, current_user: Optional[User] = Depends(get_current_user_optional)):
    if current_user is None:
        return RedirectResponse(url="/auth/login?next=/dashboard", status_code=status.HTTP_302_FOUND)

    # Import here to avoid circular import
    from visiofirm.projects import VFProjects
    from visiofirm.models.user import get_user_projects

    projects_list = VFProjects.list(PROJECTS_FOLDER) or []
    if not current_user.is_superadmin:
        allowed_projects = set(get_user_projects(current_user.id))
        projects_list = [p for p in projects_list if p.get('name') in allowed_projects]

    projects = []

    for p in projects_list:
        # Ensure we use a safe, canonical project folder for all operations
        safe_name = secure_filename(p.get('name', ''))
        project_full_path = os.path.join(PROJECTS_FOLDER, safe_name)

        # skip projects without config.db
        if not os.path.exists(os.path.join(project_full_path, 'config.db')):
            continue

        project = Project(p['name'], '', '', project_full_path)
        try:
            p['setup_type'] = project.get_setup_type()
        except Exception as e:
            logger.warning("Failed to get setup_type for %s: %s", p.get('name'), e)
            p['setup_type'] = ''

        # Always use the canonical path (project_full_path) when listing media
        if 'Video' in p.get('setup_type', ''):
            videos_path = os.path.join(project_full_path, 'videos')
            video_files = []
            if os.path.exists(videos_path):
                try:
                    video_files = [
                        f for f in os.listdir(videos_path)
                        if os.path.isfile(os.path.join(videos_path, f)) and os.path.splitext(f)[1].lower() in VALID_VIDEO_EXTENSIONS
                    ]
                    # newest first
                    video_files = sorted(
                        video_files,
                        key=lambda f: os.path.getmtime(os.path.join(videos_path, f)),
                        reverse=True
                    )
                except Exception as e:
                    logger.error("Error listing videos for %s: %s", safe_name, e)
                    video_files = []
            p['videos'] = [os.path.join('/projects', safe_name, 'videos', vid) for vid in video_files[:3]]
        else:
            images_path = os.path.join(project_full_path, 'images')
            image_files = []
            if os.path.exists(images_path):
                try:
                    image_files = [
                        f for f in os.listdir(images_path)
                        if os.path.isfile(os.path.join(images_path, f)) and os.path.splitext(f)[1].lower() in VALID_IMAGE_EXTENSIONS
                    ]
                    # newest first
                    image_files = sorted(
                        image_files,
                        key=lambda f: os.path.getmtime(os.path.join(images_path, f)),
                        reverse=True
                    )
                except Exception as e:
                    logger.error("Error listing images for %s: %s", safe_name, e)
                    image_files = []
            p['images'] = [os.path.join('/projects', safe_name, 'images', img) for img in image_files[:3]]

        if 'Video' in p.get('setup_type', ''):
            p['image_count'] = len(video_files)
        else:
            p['image_count'] = len(image_files)

        # ensure p has a canonical path field for template use
        p['path'] = project_full_path
        projects.append(p)

    return templates.TemplateResponse('dashboard.html', {"request": request, "projects": projects, "user": current_user})

@router.post("/log_error")
async def log_error(
    request: Request,
    current_user: User = Depends(get_current_user_from_cookie)
):
    tracker = getattr(request.app, "tracker", None)
    data = await request.json()
    error_msg = data.get('message', 'Unknown frontend error')
    endpoint = data.get('endpoint', 'unknown')
    status_code = data.get('status', 0)
    try:
        class FrontendError(Exception):
            pass
        fe = FrontendError(f"Frontend error on {endpoint}: {error_msg} (status: {status_code})")
        if tracker is not None and hasattr(tracker, "log_error"):
            tracker.log_error(fe, step='Frontend error report')
        logger.error(f"Frontend error logged: {error_msg} on {endpoint} (status: {status_code})")
        return {"success": True}
    except Exception as e:
        logger.exception("Failed to log frontend error")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/delete_project/{project_name}")
async def delete_project(request: Request, project_name: str, current_user: User = Depends(get_current_user_from_cookie)):
    if not current_user.is_superadmin:
        raise HTTPException(status_code=403, detail="Only superadmin can delete projects")
    # Import here to avoid circular import
    from visiofirm.projects import VFProjects
    logger.info("Deleting project: %s", project_name)
    try:
        deleted = VFProjects.delete_project(project_name, PROJECTS_FOLDER)
    except Exception as e:
        logger.exception("Error deleting project %s", project_name)
        raise HTTPException(status_code=500, detail=str(e))

    if deleted:
        logger.info("Deleted project %s", project_name)
        return {"success": True}
    raise HTTPException(status_code=404, detail='Project not found')

@router.post("/duplicate_project/{project_name}")
async def duplicate_project(
    request: Request,
    project_name: str,
    current_user: User = Depends(get_current_user_from_cookie)
):
    if not current_user.is_superadmin:
        raise HTTPException(status_code=403, detail="Only superadmin can duplicate projects")
    from visiofirm.projects import VFProjects
    try:
        body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    except Exception:
        body = {}
    new_name = body.get("new_name")
    include_annotations = body.get("include_annotations", True)
    
    logger.info("Duplicating project '%s' to '%s' (include_annotations=%s)", project_name, new_name, include_annotations)
    try:
        cloned_name = VFProjects.duplicate_project(
            project_name,
            new_name=new_name,
            include_annotations=include_annotations,
            projects_folder=PROJECTS_FOLDER
        )
        return {"success": True, "new_project_name": cloned_name}
    except FileNotFoundError as e:
        logger.warning("Project not found for duplication: %s", e)
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Error duplicating project %s", project_name)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/get_project_overview/{project_name}")
async def get_project_overview(request: Request, project_name: str, current_user: User = Depends(get_current_user_from_cookie)):
    from visiofirm.models.user import user_has_project_access
    if not user_has_project_access(current_user, project_name):
        raise HTTPException(status_code=403, detail="Access denied")
    safe_name = secure_filename(project_name)
    project_path = os.path.join(PROJECTS_FOLDER, safe_name)
    if not os.path.exists(project_path):
        raise HTTPException(status_code=404, detail='Project not found')

    try:
        project = Project(project_name, '', '', project_path)
        total_images = project.get_image_count() or 0
        annotated_images = project.get_annotated_image_count() or 0
        class_distribution = project.get_class_distribution() or {}
        annotations_per_image = project.get_annotations_per_image() or []
        non_annotated_images = max(0, total_images - annotated_images)
        total_annotations = sum(class_distribution.values()) if class_distribution else 0
        total_classes = len(project.get_classes() or [])
        annotated_pct = round((annotated_images / total_images * 100), 1) if total_images > 0 else 0
        setup_type = project.get_setup_type() or 'Bounding Box'

        data = {
            'project_name': project_name,
            'setup_type': setup_type,
            'total_images': total_images,
            'annotated_images': annotated_images,
            'non_annotated_images': non_annotated_images,
            'annotated_percentage': annotated_pct,
            'total_annotations': total_annotations,
            'total_classes': total_classes,
            'class_distribution': class_distribution,
            'annotations_per_image': annotations_per_image
        }
        logger.info("Project overview for %s: %s total, %s annotated, %s classes", project_name, total_images, annotated_images, total_classes)
        return data
    except Exception as e:
        logger.exception("Error fetching overview for %s", project_name)
        raise HTTPException(status_code=500, detail=f'Server error: {str(e)}')

@router.post("/add_classes/{project_name}")
async def add_classes(
    request: Request,
    project_name: str,
    current_user: User = Depends(get_current_user_from_cookie)
):
    data = await request.json()
    classes_to_add = data.get('classes', [])  # Expect list of strings
    if not classes_to_add or not isinstance(classes_to_add, list):
        raise HTTPException(status_code=400, detail='classes must be a non-empty list of strings')
    
    from visiofirm.projects import VFProjects
    project = VFProjects.get_project(project_name)
    if not project:
        raise HTTPException(status_code=404, detail='Project not found')
    
    try:
        project.add_classes(classes_to_add)
        logger.info(f"Added {len(classes_to_add)} classes to project {project_name}: {classes_to_add}")
        return {"success": True, "added": len(classes_to_add), "classes": classes_to_add}
    except Exception as e:
        logger.error(f"Error adding classes to {project_name}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    
# Add this endpoint to dashboard.py, after get_project_overview
@router.get("/get_project_classes/{project_name}")
async def get_project_classes(request: Request, project_name: str, current_user: User = Depends(get_current_user_from_cookie)):
    from visiofirm.models.user import user_has_project_access
    if not user_has_project_access(current_user, project_name):
        raise HTTPException(status_code=403, detail="Access denied")
    safe_name = secure_filename(project_name)
    project_path = os.path.join(PROJECTS_FOLDER, safe_name)
    if not os.path.exists(project_path):
        raise HTTPException(status_code=404, detail='Project not found')
    
    try:
        from visiofirm.models import Project
        project = Project(project_name, '', '', project_path)
        classes = project.get_classes() or []
        logger.info(f"Retrieved {len(classes)} classes for project {project_name}: {classes}")
        return {"success": True, "classes": classes}
    except Exception as e:
        logger.exception("Error fetching classes for %s", project_name)
        raise HTTPException(status_code=500, detail=f'Server error: {str(e)}')

@router.get("/get_project_class_stats/{project_name}")
async def get_project_class_stats(request: Request, project_name: str, current_user: User = Depends(get_current_user_from_cookie)):
    from visiofirm.models.user import user_has_project_access
    if not user_has_project_access(current_user, project_name):
        raise HTTPException(status_code=403, detail="Access denied")
    safe_name = secure_filename(project_name)
    project_path = os.path.join(PROJECTS_FOLDER, safe_name)
    db_path = os.path.join(project_path, "config.db")
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail='Project not found')

    try:
        with closing(sqlite3.connect(db_path)) as conn, conn:
            cursor = conn.cursor()
            cursor.execute("SELECT class_name FROM Classes ORDER BY rowid")
            classes = [row[0] for row in cursor.fetchall()]

            cursor.execute("SELECT class_name, COUNT(*) FROM Annotations GROUP BY class_name")
            anno_counts = dict(cursor.fetchall())

            cursor.execute("SELECT class_name, COUNT(*) FROM Preannotations GROUP BY class_name")
            preanno_counts = dict(cursor.fetchall())

        stats = []
        for idx, cls in enumerate(classes):
            stats.append({
                "id": idx,
                "class_name": cls,
                "annotations_count": anno_counts.get(cls, 0),
                "preannotations_count": preanno_counts.get(cls, 0),
                "total_count": anno_counts.get(cls, 0) + preanno_counts.get(cls, 0)
            })

        return {"success": True, "stats": stats}
    except Exception as e:
        logger.exception("Error fetching class stats for %s", project_name)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/rename_project_class/{project_name}")
async def rename_project_class(request: Request, project_name: str, current_user: User = Depends(get_current_user_from_cookie)):
    safe_name = secure_filename(project_name)
    project_path = os.path.join(PROJECTS_FOLDER, safe_name)
    db_path = os.path.join(project_path, "config.db")
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail='Project not found')

    data = await request.json()
    old_class = (data.get('old_class') or '').strip()
    new_class = (data.get('new_class') or '').strip()
    if not old_class or not new_class:
        raise HTTPException(status_code=400, detail='Both old_class and new_class are required')

    try:
        with closing(sqlite3.connect(db_path)) as conn, conn:
            conn.execute("PRAGMA foreign_keys = OFF")
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM Classes WHERE class_name = ?", (old_class,))
            if cursor.fetchone() is None:
                raise HTTPException(status_code=404, detail='Class not found')
            cursor.execute("SELECT 1 FROM Classes WHERE class_name = ?", (new_class,))
            target_exists = cursor.fetchone() is not None

            # Update in Annotations and Preannotations
            cursor.execute("UPDATE Annotations SET class_name = ? WHERE class_name = ?", (new_class, old_class))
            ann_updated = cursor.rowcount

            cursor.execute("UPDATE Preannotations SET class_name = ? WHERE class_name = ?", (new_class, old_class))
            pre_updated = cursor.rowcount

            if old_class != new_class:
                if target_exists:
                    cursor.execute("DELETE FROM Classes WHERE class_name = ?", (old_class,))
                else:
                    cursor.execute("UPDATE Classes SET class_name = ? WHERE class_name = ?", (new_class, old_class))

            conn.commit()

        return {
            "success": True,
            "old_class": old_class,
            "new_class": new_class,
            "annotations_updated": ann_updated,
            "preannotations_updated": pre_updated
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error renaming class in %s", project_name)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/delete_project_class/{project_name}")
async def delete_project_class(request: Request, project_name: str, current_user: User = Depends(get_current_user_from_cookie)):
    safe_name = secure_filename(project_name)
    project_path = os.path.join(PROJECTS_FOLDER, safe_name)
    db_path = os.path.join(project_path, "config.db")
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail='Project not found')

    data = await request.json()
    class_name = (data.get('class_name') or '').strip()
    delete_class_entry = data.get('delete_class_entry', True)
    if not class_name:
        raise HTTPException(status_code=400, detail='class_name is required')

    try:
        with closing(sqlite3.connect(db_path)) as conn, conn:
            conn.execute("PRAGMA foreign_keys = OFF")
            cursor = conn.cursor()

            cursor.execute("DELETE FROM Annotations WHERE class_name = ?", (class_name,))
            ann_deleted = cursor.rowcount

            cursor.execute("DELETE FROM Preannotations WHERE class_name = ?", (class_name,))
            pre_deleted = cursor.rowcount

            if delete_class_entry:
                cursor.execute("DELETE FROM Classes WHERE class_name = ?", (class_name,))

            conn.commit()

        return {
            "success": True,
            "class_name": class_name,
            "annotations_deleted": ann_deleted,
            "preannotations_deleted": pre_deleted
        }
    except Exception as e:
        logger.exception("Error deleting class in %s", project_name)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/reorder_project_classes/{project_name}")
async def reorder_project_classes(request: Request, project_name: str, current_user: User = Depends(get_current_user_from_cookie)):
    safe_name = secure_filename(project_name)
    project_path = os.path.join(PROJECTS_FOLDER, safe_name)
    db_path = os.path.join(project_path, "config.db")
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail='Project not found')

    data = await request.json()
    new_classes_order = data.get('classes', [])
    if not isinstance(new_classes_order, list) or not new_classes_order or not all(isinstance(cls, str) and cls.strip() == cls and cls for cls in new_classes_order):
        raise HTTPException(status_code=400, detail='classes array is required')

    try:
        with closing(sqlite3.connect(db_path)) as conn, conn:
            conn.execute("PRAGMA foreign_keys = OFF")
            cursor = conn.cursor()
            cursor.execute("SELECT class_name FROM Classes")
            existing_classes = [row[0] for row in cursor.fetchall()]
            if len(new_classes_order) != len(existing_classes) or set(new_classes_order) != set(existing_classes):
                raise HTTPException(status_code=400, detail='classes must contain every current class exactly once')
            cursor.execute("DELETE FROM Classes")
            for cls in new_classes_order:
                cursor.execute("INSERT INTO Classes (class_name) VALUES (?)", (cls,))
            conn.commit()

        return {"success": True, "classes": new_classes_order}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error reordering classes in %s", project_name)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/run_project_edge_filter/{project_name}")
async def run_project_edge_filter(request: Request, project_name: str, current_user: User = Depends(get_current_user_from_cookie)):
    safe_name = secure_filename(project_name)
    project_path = os.path.join(PROJECTS_FOLDER, safe_name)
    db_path = os.path.join(project_path, "config.db")
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail='Project not found')

    data = await request.json()
    mode = data.get('mode', 'move')
    tolerance = int(data.get('tolerance', 0))
    edge_class = (data.get('class_name') or '_edge_review').strip()

    try:
        def touches_edge(x, y, w, h, img_w, img_h, tol):
            return (
                x <= tol or
                y <= tol or
                x + w >= img_w - tol or
                y + h >= img_h - tol
            )

        with closing(sqlite3.connect(db_path)) as conn, conn:
            conn.execute("PRAGMA foreign_keys = OFF")
            cursor = conn.cursor()

            if mode == 'delete':
                cursor.execute("DELETE FROM Annotations WHERE class_name = ?", (edge_class,))
                ann_deleted = cursor.rowcount
                cursor.execute("DELETE FROM Preannotations WHERE class_name = ?", (edge_class,))
                pre_deleted = cursor.rowcount
                cursor.execute("DELETE FROM Classes WHERE class_name = ?", (edge_class,))
                conn.commit()
                return {
                    "success": True,
                    "mode": "delete",
                    "deleted_count": ann_deleted + pre_deleted,
                    "edge_class": edge_class
                }

            # mode == 'move'
            cursor.execute("INSERT OR IGNORE INTO Classes (class_name) VALUES (?)", (edge_class,))
            cursor.execute("SELECT image_id, width, height FROM Images")
            images = cursor.fetchall()

            total_flagged = 0
            affected_images = set()

            for table, id_col in [("Annotations", "annotation_id"), ("Preannotations", "preannotation_id")]:
                for image_id, img_w, img_h in images:
                    if img_w is None or img_h is None:
                        continue

                    cursor.execute(
                        f"SELECT {id_col}, x, y, width, height FROM {table} WHERE image_id = ? AND class_name != ?",
                        (image_id, edge_class)
                    )
                    rows = cursor.fetchall()
                    flagged_ids = []
                    for row_id, x, y, w, h in rows:
                        if x is None or y is None or w is None or h is None:
                            continue
                        if touches_edge(x, y, w, h, img_w, img_h, tolerance):
                            flagged_ids.append(row_id)

                    if flagged_ids:
                        cursor.executemany(
                            f"UPDATE {table} SET class_name = ? WHERE {id_col} = ?",
                            [(edge_class, rid) for rid in flagged_ids]
                        )
                        total_flagged += len(flagged_ids)
                        affected_images.add(image_id)

            conn.commit()

        return {
            "success": True,
            "mode": "move",
            "flagged_count": total_flagged,
            "affected_images_count": len(affected_images),
            "edge_class": edge_class
        }
    except Exception as e:
        logger.exception("Error running edge filter for %s", project_name)
        raise HTTPException(status_code=500, detail=str(e))

# Synchronous routes run pixel decoding and SQLite work in FastAPI's thread pool.
def _duplicate_project_path(project_name):
    root = Path(PROJECTS_FOLDER).resolve()
    safe_name = secure_filename(project_name)
    path = (root / safe_name).resolve()
    if not safe_name or path == root or not path.is_relative_to(root) or not (path / "config.db").is_file():
        raise HTTPException(status_code=404, detail="Project not found")
    import sqlite3
    from contextlib import closing
    with closing(sqlite3.connect(path / "config.db")) as conn:
        row = conn.execute("SELECT setup_type FROM Project_Configuration LIMIT 1").fetchone()
    if not row or "Video" in row[0]:
        raise HTTPException(status_code=400, detail="Duplicate cleanup supports image projects only")
    return path


class DuplicateMember(BaseModel):
    image_id: StrictInt
    state: str


class DuplicateSelection(BaseModel):
    members: list[DuplicateMember]
    token: str
    keep_id: StrictInt
    remove_ids: list[StrictInt]


class DuplicateCleanupRequest(BaseModel):
    groups: list[DuplicateSelection]
    confirm_loss: StrictBool = False


@router.post("/scan_duplicates/{project_name}")
def scan_project_duplicates(project_name: str, current_user: User = Depends(get_current_user_from_cookie)):
    from visiofirm.duplicates import scan_duplicates
    return scan_duplicates(_duplicate_project_path(project_name))


@router.post("/clean_duplicates/{project_name}")
def clean_project_duplicates(project_name: str, data: DuplicateCleanupRequest,
                             current_user: User = Depends(get_current_user_from_cookie)):
    from visiofirm.duplicates import clean_duplicates
    return clean_duplicates(_duplicate_project_path(project_name),
                            [group.dict() for group in data.groups], data.confirm_loss)
