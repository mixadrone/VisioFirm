import sqlite3
from passlib.context import CryptContext
from visiofirm.config import get_cache_folder
import os
import secrets
from typing import List, Optional, Tuple, Dict, Any

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_db_path():
    return os.path.join(get_cache_folder(), 'users.db')

def init_db():
    db_path = get_db_path()
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                company TEXT,
                api_key TEXT UNIQUE,
                role TEXT DEFAULT 'user'
            )
        ''')
        # Check if 'role' column exists in legacy tables and add if missing
        cursor.execute("PRAGMA table_info(users)")
        columns = [row[1] for row in cursor.fetchall()]
        if 'role' not in columns:
            cursor.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'")

        # Create user_projects mapping table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                project_name TEXT NOT NULL,
                UNIQUE(user_id, project_name),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        ''')
        conn.commit()

def create_user(first_name, last_name, username, email, password, company="", role="user"):
    init_db()
    db_path = get_db_path()
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        password_hash = pwd_context.hash(password)
        try:
            cursor.execute('''
                INSERT INTO users (first_name, last_name, username, email, password_hash, company, api_key, role)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (first_name, last_name, username, email, password_hash, company, None, role))
            conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False

def update_user(user_id, updates):
    init_db()
    db_path = get_db_path()
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        try:
            if 'password' in updates:
                updates['password_hash'] = pwd_context.hash(updates.pop('password'))
            set_clause = ', '.join(f"{key} = ?" for key in updates)
            values = list(updates.values()) + [user_id]
            cursor.execute(f'''
                UPDATE users
                SET {set_clause}
                WHERE id = ?
            ''', values)
            conn.commit()
            return cursor.rowcount > 0
        except sqlite3.IntegrityError:
            return False

def generate_api_key(user_id):
    init_db()
    db_path = get_db_path()
    api_key = secrets.token_urlsafe(32)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        try:
            cursor.execute('''
                UPDATE users SET api_key = ? WHERE id = ?
            ''', (api_key, user_id))
            conn.commit()
            return api_key
        except sqlite3.IntegrityError:
            return None

def get_user_by_username(username):
    init_db()
    db_path = get_db_path()
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, username, password_hash, first_name, last_name, email, company, api_key, role
            FROM users WHERE username = ?
        ''', (username,))
        return cursor.fetchone()

def get_user_by_email(email):
    init_db()
    db_path = get_db_path()
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, username, password_hash, first_name, last_name, email, company, api_key, role
            FROM users WHERE email = ?
        ''', (email,))
        return cursor.fetchone()

def get_user_by_id(user_id):
    init_db()
    db_path = get_db_path()
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, username, password_hash, first_name, last_name, email, company, api_key, role
            FROM users WHERE id = ?
        ''', (user_id,))
        return cursor.fetchone()

def get_user_by_api_key(api_key):
    init_db()
    db_path = get_db_path()
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, username, password_hash, first_name, last_name, email, company, api_key, role
            FROM users WHERE api_key = ?
        ''', (api_key,))
        return cursor.fetchone()

def get_all_users() -> List[Dict[str, Any]]:
    init_db()
    db_path = get_db_path()
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, username, first_name, last_name, email, company, role
            FROM users
            ORDER BY id ASC
        ''')
        rows = cursor.fetchall()
        users = []
        for r in rows:
            users.append({
                'id': r[0],
                'username': r[1],
                'first_name': r[2],
                'last_name': r[3],
                'email': r[4],
                'company': r[5] or '',
                'role': r[6] or 'user'
            })
        return users

def delete_user(user_id: int) -> bool:
    init_db()
    db_path = get_db_path()
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM user_projects WHERE user_id = ?', (user_id,))
        cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
        conn.commit()
        return cursor.rowcount > 0

def get_user_projects(user_id: int) -> List[str]:
    init_db()
    db_path = get_db_path()
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT project_name FROM user_projects WHERE user_id = ?
        ''', (user_id,))
        return [row[0] for row in cursor.fetchall()]

def set_user_projects(user_id: int, project_names: List[str]):
    init_db()
    db_path = get_db_path()
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM user_projects WHERE user_id = ?', (user_id,))
        for p in project_names:
            if p and p.strip():
                cursor.execute('''
                    INSERT OR IGNORE INTO user_projects (user_id, project_name)
                    VALUES (?, ?)
                ''', (user_id, p.strip()))
        conn.commit()

def user_has_project_access(user: 'User', project_name: str) -> bool:
    if not user:
        return False
    if user.is_superadmin:
        return True
    assigned = get_user_projects(user.id)
    return project_name in assigned

class User:
    def __init__(self, user_id, username, first_name, last_name, email, company, api_key=None, role='user'):
        self.id = user_id
        self.username = username
        self.first_name = first_name
        self.last_name = last_name
        self.email = email
        self.company = company
        self.api_key = api_key
        self.role = role or 'user'

    @property
    def is_superadmin(self) -> bool:
        return self.role == 'superadmin'

    @property
    def avatar(self):
        return f"{self.first_name[0]}.{self.last_name[0]}" if self.first_name and self.last_name else ""