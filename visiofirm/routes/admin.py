# visiofirm/routes/admin.py
from fastapi import APIRouter, Request, Depends, HTTPException, status, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from visiofirm.security import require_superadmin, User
from visiofirm.models.user import (
    get_all_users,
    create_user,
    delete_user,
    get_user_projects,
    set_user_projects,
    update_user,
    get_user_by_id
)
from visiofirm.config import PROJECTS_FOLDER
from visiofirm.projects import VFProjects
from typing import Optional, List
import os
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin")
module_dir = os.path.dirname(__file__)
templates_dir = os.path.join(module_dir, "..", "templates")
templates = Jinja2Templates(directory=templates_dir)

@router.get("/users", response_class=HTMLResponse, name="admin.users")
async def list_users(
    request: Request,
    current_user: User = Depends(require_superadmin)
):
    users = get_all_users()
    all_projects = [p.get("name") for p in (VFProjects.list(PROJECTS_FOLDER) or []) if p.get("name")]
    
    # Attach assigned projects to each user
    for u in users:
        u["assigned_projects"] = get_user_projects(u["id"])
    
    return templates.TemplateResponse(
        "admin_users.html",
        {
            "request": request,
            "user": current_user,
            "users": users,
            "all_projects": all_projects
        }
    )

@router.post("/users/create", name="admin.create_user")
async def admin_create_user(
    request: Request,
    first_name: str = Form(...),
    last_name: str = Form(...),
    username: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    company: str = Form(""),
    role: str = Form("user"),
    current_user: User = Depends(require_superadmin)
):
    if not all([first_name, last_name, username, email, password]):
        return RedirectResponse(
            url="/admin/users?flash=error&message=All fields except company are required",
            status_code=status.HTTP_303_SEE_OTHER
        )
    
    role = role if role in ["superadmin", "user"] else "user"
    success = create_user(
        first_name=first_name.strip(),
        last_name=last_name.strip(),
        username=username.strip(),
        email=email.strip(),
        password=password,
        company=company.strip(),
        role=role
    )
    if success:
        logger.info("Admin %s created user %s (%s)", current_user.username, username, role)
        return RedirectResponse(
            url=f"/admin/users?flash=success&message=User {username} created successfully",
            status_code=status.HTTP_303_SEE_OTHER
        )
    return RedirectResponse(
        url="/admin/users?flash=error&message=Username or email already exists",
        status_code=status.HTTP_303_SEE_OTHER
    )

@router.post("/users/{user_id}/projects", name="admin.update_projects")
async def admin_update_user_projects(
    user_id: int,
    request: Request,
    current_user: User = Depends(require_superadmin)
):
    target_user = get_user_by_id(user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    form = await request.form()
    # Get all project checkboxes checked for this user
    projects = form.getlist("projects")
    set_user_projects(user_id, projects)
    
    logger.info("Admin %s updated projects for user %s: %s", current_user.username, target_user[1], projects)
    return RedirectResponse(
        url=f"/admin/users?flash=success&message=Projects updated for {target_user[1]}",
        status_code=status.HTTP_303_SEE_OTHER
    )

@router.post("/users/{user_id}/delete", name="admin.delete_user")
async def admin_delete_user(
    user_id: int,
    current_user: User = Depends(require_superadmin)
):
    if user_id == current_user.id:
        return RedirectResponse(
            url="/admin/users?flash=error&message=You cannot delete your own superadmin account",
            status_code=status.HTTP_303_SEE_OTHER
        )
    
    success = delete_user(user_id)
    if success:
        return RedirectResponse(
            url="/admin/users?flash=success&message=User deleted successfully",
            status_code=status.HTTP_303_SEE_OTHER
        )
    raise HTTPException(status_code=404, detail="User not found")
