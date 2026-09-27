"""Persistent image approval state, independent of annotation geometry."""

APPROVED_SQL = """(
    NOT EXISTS (SELECT 1 FROM UnreviewedImages u WHERE u.image_id = i.image_id)
    AND (EXISTS (SELECT 1 FROM Annotations a WHERE a.image_id = i.image_id)
         OR EXISTS (SELECT 1 FROM ReviewedImages r WHERE r.image_id = i.image_id))
)"""

# Pending predictions take precedence without erasing the previous approval.
ANNOTATED_SQL = f"""(
    {APPROVED_SQL}
    AND NOT EXISTS (SELECT 1 FROM Preannotations p WHERE p.image_id = i.image_id)
)"""


def initialize_review_status(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS UnreviewedImages (
        image_id INTEGER PRIMARY KEY,
        FOREIGN KEY (image_id) REFERENCES Images(image_id)
    )''')


def set_image_approval(conn, image_id, approved):
    """Update approval within the caller's transaction without touching labels."""
    if approved:
        conn.execute('DELETE FROM UnreviewedImages WHERE image_id = ?', (image_id,))
        conn.execute('INSERT OR REPLACE INTO ReviewedImages (image_id) VALUES (?)', (image_id,))
    else:
        conn.execute('DELETE FROM ReviewedImages WHERE image_id = ?', (image_id,))
        conn.execute('INSERT OR IGNORE INTO UnreviewedImages (image_id) VALUES (?)', (image_id,))
