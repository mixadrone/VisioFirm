// classManagement.js — Full management for project classes: Stats, Rename, Merge, Reorder, Delete, and Edge Filtering
import { classColors } from './globals.js';
import { filterByClass } from './viewManagement.js';

let projectClasses = [];
let classStats = {};
let projectName = '';

export function initClassManagement(config) {
    projectName = config.projectName;
    projectClasses = Array.isArray(config.classes) ? [...config.classes] : [];

    const refreshBtn = document.getElementById('classes-refresh-stats-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => loadClassStats(true));
    }

    // Modal listeners
    initModals();

    // Edge Filter listeners
    initEdgeFilter();

    // Reload stats when switching to the Classes tab
    document.addEventListener('project-tab-change', (e) => {
        if (e.detail === 'classes') {
            loadClassStats();
        }
    });

    const classesTabBtn = document.querySelector('.project-tab-btn[data-tab-target="classes"]');
    if (classesTabBtn) {
        classesTabBtn.addEventListener('click', () => loadClassStats());
    }

    // Delegated click handler on the table container to guarantee buttons always trigger
    const tableContainer = document.querySelector('.classes-table-container');
    if (tableContainer) {
        tableContainer.addEventListener('click', (e) => {
            const renameBtn = e.target.closest('.action-rename');
            if (renameBtn) {
                const tr = renameBtn.closest('tr');
                const cls = tr ? tr.dataset.class : null;
                if (cls) openRenameModal(cls);
                return;
            }

            const deleteBtn = e.target.closest('.action-delete');
            if (deleteBtn) {
                const tr = deleteBtn.closest('tr');
                const cls = tr ? tr.dataset.class : null;
                if (cls) {
                    const stat = classStats[cls] || { annotations_count: 0, preannotations_count: 0, total_count: 0 };
                    openDeleteConfirmModal(cls, stat);
                }
                return;
            }
        });
    }

    // Render immediately from initial config so table is never blank
    renderClassTable();

    // Initial load for full stats
    loadClassStats();
}

export async function loadClassStats(forceRender = false) {
    if (!projectName) return;
    try {
        const response = await fetch(`/dashboard/get_project_class_stats/${encodeURIComponent(projectName)}`);
        const data = await response.json();
        if (data.success && Array.isArray(data.stats)) {
            classStats = {};
            data.stats.forEach(s => {
                classStats[s.class_name] = s;
            });
            // Update projectClasses order from stats if returned
            projectClasses = data.stats.map(s => s.class_name);
            renderClassTable();
        }
    } catch (err) {
        console.error('Failed to load class stats:', err);
        if (forceRender) renderClassTable();
    }
}

function renderClassTable() {
    const tbody = document.getElementById('classes-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (projectClasses.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No classes defined for this project.</td></tr>`;
        return;
    }

    projectClasses.forEach((cls, idx) => {
        const tr = document.createElement('tr');
        tr.dataset.class = cls;
        tr.dataset.index = idx;

        const stat = classStats[cls] || { annotations_count: 0, preannotations_count: 0, total_count: 0 };
        const color = classColors[cls] || '#22c55e';

        tr.innerHTML = `
            <td>
                <div class="class-id-badge">
                    <span>${idx}</span>
                    <button type="button" class="class-reorder-btn reorder-up" title="Move Up" ${idx === 0 ? 'disabled' : ''}>▲</button>
                    <button type="button" class="class-reorder-btn reorder-down" title="Move Down" ${idx === projectClasses.length - 1 ? 'disabled' : ''}>▼</button>
                </div>
            </td>
            <td>
                <input type="color" class="class-color-picker-input" value="${color.slice(0, 7)}" data-class="${cls}" title="Change Class Color">
            </td>
            <td>
                <span class="class-name-cell" title="Click to view in gallery">${cls}</span>
            </td>
            <td style="text-align: right;">
                <span class="class-stat-num">${stat.annotations_count}</span>
            </td>
            <td style="text-align: right;">
                <span class="class-stat-num" style="color: #a78bfa;">${stat.preannotations_count}</span>
            </td>
            <td style="text-align: right;">
                <span class="class-stat-total">${stat.total_count}</span>
            </td>
            <td>
                <div class="class-actions-group">
                    <button type="button" class="class-action-btn action-view" title="Filter gallery by this class">
                        <i class="fa-solid fa-eye"></i> View
                    </button>
                    <button type="button" class="class-action-btn action-rename" title="Rename or merge class">
                        <i class="fa-solid fa-pen"></i> Rename
                    </button>
                    <button type="button" class="class-action-btn danger-btn action-delete" title="Delete annotations or remove class">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </td>
        `;

        // Event listeners for row buttons
        tr.querySelector('.class-name-cell').addEventListener('click', () => filterAndGoToGallery(cls));
        tr.querySelector('.action-view').addEventListener('click', () => filterAndGoToGallery(cls));

        tr.querySelector('.action-rename')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openRenameModal(cls);
        });

        tr.querySelector('.action-delete')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentStat = classStats[cls] || { annotations_count: 0, preannotations_count: 0, total_count: 0 };
            openDeleteConfirmModal(cls, currentStat);
        });

        tr.querySelector('.reorder-up').addEventListener('click', () => moveClassIndex(idx, idx - 1));
        tr.querySelector('.reorder-down').addEventListener('click', () => moveClassIndex(idx, idx + 1));

        tr.querySelector('.class-color-picker-input').addEventListener('change', (e) => {
            const newColor = e.target.value;
            classColors[cls] = newColor;
            // Update color dots across page
            document.querySelectorAll(`.card-class-dot[data-class="${cls}"], .filter-class-dot[data-class="${cls}"]`).forEach(dot => {
                dot.style.backgroundColor = newColor;
            });
        });

        tbody.appendChild(tr);
    });
}

function filterAndGoToGallery(cls) {
    const imagesTabBtn = document.querySelector('.project-tab-btn[data-tab-target="images"]');
    if (imagesTabBtn) imagesTabBtn.click();
    filterByClass(cls);
}

async function moveClassIndex(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= projectClasses.length) return;
    const previousOrder = [...projectClasses];
    const moved = projectClasses.splice(fromIndex, 1)[0];
    projectClasses.splice(toIndex, 0, moved);
    renderClassTable();

    try {
        const response = await fetch(`/dashboard/reorder_project_classes/${encodeURIComponent(projectName)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ classes: projectClasses })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.detail || 'Failed to save class order');
        }
    } catch (e) {
        console.error('Failed to save reordered classes:', e);
        projectClasses = previousOrder;
        renderClassTable();
        alert(e.message || 'Failed to save class order');
    }
}

// ---------------------------------------------------------------------------
// Modals & Actions
// ---------------------------------------------------------------------------

function initModals() {
    const renameModal = document.getElementById('rename-class-modal');
    const renameForm = document.getElementById('rename-class-form');
    const renameClose = document.getElementById('rename-class-close-btn');
    const renameCancel = document.getElementById('rename-class-cancel-btn');

    const confirmModal = document.getElementById('confirm-class-action-modal');
    const confirmClose = document.getElementById('confirm-class-action-close-btn');
    const confirmCancel = document.getElementById('confirm-class-action-cancel-btn');

    const closeRename = () => {
        if (renameModal) {
            renameModal.classList.remove('active');
            renameModal.style.display = 'none';
        }
    };

    const closeConfirm = () => {
        if (confirmModal) {
            confirmModal.classList.remove('active');
            confirmModal.style.display = 'none';
        }
    };

    [renameClose, renameCancel].forEach(b => b?.addEventListener('click', closeRename));
    [confirmClose, confirmCancel].forEach(b => b?.addEventListener('click', closeConfirm));

    if (renameForm) {
        renameForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const oldClass = document.getElementById('rename-class-old').value.trim();
            const newClass = document.getElementById('rename-class-new').value.trim();
            if (!oldClass || !newClass) return;

            if (oldClass === newClass) {
                closeRename();
                return;
            }
            await executeRenameClass(oldClass, newClass);
        });
    }

    // Close on backdrop click
    [renameModal, confirmModal].forEach(m => {
        m?.addEventListener('click', (e) => {
            if (e.target === m) {
                m.classList.remove('active');
                m.style.display = 'none';
            }
        });
    });
}

function openRenameModal(cls) {
    const renameModal = document.getElementById('rename-class-modal');
    const oldInput = document.getElementById('rename-class-old');
    const newInput = document.getElementById('rename-class-new');

    if (renameModal && oldInput && newInput) {
        oldInput.value = cls;
        newInput.value = '';
        newInput.placeholder = `New name for ${cls}`;
        renameModal.classList.add('active');
        renameModal.style.display = 'flex';
        setTimeout(() => newInput.focus(), 50);
        return;
    }

    // Fallback in case modal element was not found
    const newName = prompt(`Rename class "${cls}" to (or merge into):`, cls);
    if (newName && newName.trim() && newName.trim() !== cls) {
        executeRenameClass(cls, newName.trim());
    }
}

async function executeRenameClass(oldClass, newClass) {
    try {
        const response = await fetch(`/dashboard/rename_project_class/${encodeURIComponent(projectName)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_class: oldClass, new_class: newClass })
        });
        const res = await response.json();
        if (res.success) {
            window.location.reload();
        } else {
            alert(res.detail || 'Failed to rename class');
        }
    } catch (err) {
        console.error(err);
        alert('Error updating class');
    }
}

function openDeleteConfirmModal(cls, stat) {
    const modal = document.getElementById('confirm-class-action-modal');
    const title = document.getElementById('confirm-class-modal-title');
    const body = document.getElementById('confirm-class-modal-body');
    const submitBtn = document.getElementById('confirm-class-action-submit-btn');
    if (!modal) return;

    title.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Delete Class "${cls}"`;
    body.innerHTML = `
        <p>Are you sure you want to delete class <strong>${cls}</strong>?</p>
        <div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; padding: 10px 12px; margin: 12px 0; border-radius: 4px;">
            <div>• Confirmed Annotations to be removed: <strong>${stat.annotations_count}</strong></div>
            <div>• AI Pre-annotations to be removed: <strong>${stat.preannotations_count}</strong></div>
            <div style="margin-top: 4px; font-weight: 600;">Total objects affected: ${stat.total_count}</div>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-muted);">This will permanently remove all labels associated with this class.</p>
    `;

    submitBtn.onclick = async () => {
        modal.classList.remove('active');
        modal.style.display = 'none';
        try {
            const response = await fetch(`/dashboard/delete_project_class/${encodeURIComponent(projectName)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ class_name: cls, delete_class_entry: true })
            });
            const res = await response.json();
            if (res.success) {
                window.location.reload();
            } else {
                alert(res.detail || 'Failed to delete class');
            }
        } catch (err) {
            console.error(err);
            alert('Error deleting class');
        }
    };

    modal.classList.add('active');
    modal.style.display = 'flex';
}

// ---------------------------------------------------------------------------
// Edge Filter Integration
// ---------------------------------------------------------------------------

function initEdgeFilter() {
    const moveBtn = document.getElementById('edge-filter-move-btn');
    const deleteBtn = document.getElementById('edge-filter-delete-btn');
    const resultBox = document.getElementById('edge-filter-result');

    if (moveBtn) {
        moveBtn.addEventListener('click', async () => {
            const tolerance = parseInt(document.getElementById('edge-filter-tolerance').value || '0', 10);
            const edgeClass = document.getElementById('edge-filter-class-name').value.trim() || '_edge_review';

            moveBtn.disabled = true;
            resultBox.style.display = 'block';
            resultBox.style.background = 'rgba(99, 102, 241, 0.1)';
            resultBox.style.color = 'var(--primary-color)';
            resultBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning and flagging edge-touching bounding boxes...';

            try {
                const response = await fetch(`/dashboard/run_project_edge_filter/${encodeURIComponent(projectName)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: 'move', tolerance, class_name: edgeClass })
                });
                const res = await response.json();
                if (res.success) {
                    resultBox.style.background = 'rgba(34, 197, 94, 0.12)';
                    resultBox.style.color = '#22c55e';
                    resultBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> Flagged <strong>${res.flagged_count}</strong> labels across <strong>${res.affected_images_count}</strong> images into review class <code>${res.edge_class}</code>.`;
                    loadClassStats();
                } else {
                    resultBox.style.background = 'rgba(239, 68, 68, 0.12)';
                    resultBox.style.color = '#ef4444';
                    resultBox.textContent = res.detail || 'Edge filter failed.';
                }
            } catch (e) {
                console.error(e);
                resultBox.style.background = 'rgba(239, 68, 68, 0.12)';
                resultBox.style.color = '#ef4444';
                resultBox.textContent = 'Server error running edge filter.';
            } finally {
                moveBtn.disabled = false;
            }
        });
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            const edgeClass = document.getElementById('edge-filter-class-name').value.trim() || '_edge_review';
            const stat = classStats[edgeClass] || { total_count: 0, annotations_count: 0, preannotations_count: 0 };

            const modal = document.getElementById('confirm-class-action-modal');
            const title = document.getElementById('confirm-class-modal-title');
            const body = document.getElementById('confirm-class-modal-body');
            const submitBtn = document.getElementById('confirm-class-action-submit-btn');

            title.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Delete Edge Review Labels`;
            body.innerHTML = `
                <p>Are you sure you want to permanently delete all labels under class <strong>${edgeClass}</strong>?</p>
                <div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; padding: 10px 12px; margin: 12px 0; border-radius: 4px;">
                    <div>• Labels to be permanently removed: <strong>${stat.total_count}</strong></div>
                    <div>• Class <code>${edgeClass}</code> will be removed from project.</div>
                </div>
            `;

            submitBtn.onclick = async () => {
                modal.classList.remove('active');
                deleteBtn.disabled = true;
                resultBox.style.display = 'block';
                resultBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting edge review labels...';

                try {
                    const response = await fetch(`/dashboard/run_project_edge_filter/${encodeURIComponent(projectName)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode: 'delete', class_name: edgeClass })
                    });
                    const res = await response.json();
                    if (res.success) {
                        resultBox.style.background = 'rgba(34, 197, 94, 0.12)';
                        resultBox.style.color = '#22c55e';
                        resultBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> Deleted <strong>${res.deleted_count}</strong> labels and removed class <code>${res.edge_class}</code>.`;
                        loadClassStats();
                    }
                } catch (e) {
                    console.error(e);
                    alert('Error deleting edge review labels');
                } finally {
                    deleteBtn.disabled = false;
                }
            };

            modal.classList.add('active');
        });
    }
}
