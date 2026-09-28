import { annotationCache, currentImageKey, annotations, confidenceThreshold, setIsModified, isModified, isAdvanceAfterSaveEnabled } from './globals.js';
import { saveCacheToStorage } from './storageHandling.js';
import { updateAnnotationSummary } from './imageHandling.js';
import { navigateImage } from './viewManagement.js';
import { polygonArea } from './annotationCore.js';

let currentUpdateAnnotationStatus = null;
let toastTimeout = null;
let saveInFlight = null;
let manualSavePending = false;
let unapproveInFlight = null;
const imageApproval = new Map();

export function syncApprovalButtons() {
    const busy = Boolean(saveInFlight || unapproveInFlight || manualSavePending);
    for (const id of ['approve-btn', 'save-btn']) {
        const button = document.getElementById(id);
        if (button) button.disabled = busy;
    }
    const button = document.getElementById('unapprove-btn');
    if (button) button.disabled = busy || !imageApproval.get(currentImageKey)?.annotated;
}

export function setImageApprovalState(imageKey, annotated, unreviewed = false) {
    imageApproval.set(imageKey, { annotated, unreviewed });
    syncApprovalButtons();
}

export async function waitForApprovalOperation() {
    if (unapproveInFlight) await unapproveInFlight;
    if (saveInFlight) await saveInFlight;
}

export function unapproveCurrentImage() {
    if (unapproveInFlight) return unapproveInFlight;
    if (saveInFlight || manualSavePending || !imageApproval.get(currentImageKey)?.annotated) return Promise.resolve(false);
    const imageKey = currentImageKey;
    unapproveInFlight = performUnapprove(imageKey).finally(() => {
        unapproveInFlight = null;
        syncApprovalButtons();
    });
    syncApprovalButtons();
    return unapproveInFlight;
}

async function performUnapprove(imageKey) {
    try {
        const config = JSON.parse(document.getElementById('app-config').textContent);
        const response = await fetch('/annotation/unapprove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project: config.projectName, image: decodeURIComponent(imageKey.split('/').pop()) })
        });
        const result = await response.json();
        if (response.status === 404 && result.detail === 'Not Found') {
            showAutoSaveToast('Restart VisioFirm to enable Unapprove', true);
            return false;
        }
        if (!response.ok || !result.success) throw new Error(result.detail || result.error || `Server error: ${response.status}`);
        setImageApprovalState(imageKey, false, true);
        if (currentUpdateAnnotationStatus) currentUpdateAnnotationStatus(imageKey, false, Boolean(result.preannotated));
        showAutoSaveToast('Approval removed');
        return true;
    } catch (error) {
        console.error('Unapprove error:', error);
        showAutoSaveToast('Could not remove approval', true);
        return false;
    }
}

export function showAutoSaveToast(message = 'Auto-saved', isError = false) {
    let toast = document.getElementById('autosave-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'autosave-toast';
        toast.className = 'autosave-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = isError
        ? `<i class="fas fa-exclamation-circle"></i> <span>${message}</span>`
        : `<i class="fas fa-check-circle" style="color: #10b981;"></i> <span>${message}</span>`;

    toast.classList.toggle('error', isError);
    toast.classList.add('show');

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 1800);
}

export function executeSave(isAutoSave = false, updateAnnotationStatus = null) {
    if (unapproveInFlight) return unapproveInFlight.then(() => executeSave(isAutoSave, updateAnnotationStatus));
    if (saveInFlight) return saveInFlight;
    saveInFlight = performSave(isAutoSave, updateAnnotationStatus).finally(() => {
        saveInFlight = null;
        syncApprovalButtons();
    });
    syncApprovalButtons();
    return saveInFlight;
}

async function performSave(isAutoSave, updateAnnotationStatus) {
    if (!currentImageKey) {
        if (!isAutoSave) {
            alert('No image selected for annotation');
        }
        return false;
    }

    const savedImageKey = currentImageKey;
    const approve = !isAutoSave || !imageApproval.get(savedImageKey)?.unreviewed;
    const originalAnnotations = JSON.stringify(annotations);

    // Filter annotations to include only regular annotations and pre-annotations above confidence threshold
    const filteredAnnotations = annotations.filter(anno => {
        if (anno.isPreannotation) {
            return anno.confidence >= confidenceThreshold;
        }
        return true; // Include all non-pre-annotations
    }).map(anno => ({
        ...anno,
        isPreannotation: false // Convert kept pre-annotations to regular annotations
    }));

    const statusFn = updateAnnotationStatus || currentUpdateAnnotationStatus;

    const cocoAnnotations = filteredAnnotations
        .filter(anno => anno.type === 'rect' || anno.type === 'obbox' || anno.type === 'polygon' || anno.type === 'classification')
        .map(anno => {
            const base = {
                image_id: savedImageKey,
                category_name: anno.label,
                score: 1.0
            };
            if (anno.type === 'classification') {
                return {
                    ...base,
                    type: 'classification'
                };
            }
            if (anno.type === 'rect' || anno.type === 'obbox') {
                return {
                    ...base,
                    bbox: [anno.x, anno.y, anno.width, anno.height],
                    rotation: anno.rotation || 0,
                    segmentation: [],
                    area: anno.width * anno.height
                };
            }
            if (anno.type === 'polygon') {
                const seg = anno.points.flatMap(p => [p.x, p.y]);
                const xs = seg.filter((_, i) => i % 2 === 0);
                const ys = seg.filter((_, i) => i % 2 === 1);
                const bbox = [
                    Math.min(...xs),
                    Math.min(...ys),
                    Math.max(...xs) - Math.min(...xs),
                    Math.max(...ys) - Math.min(...ys)
                ];
                return {
                    ...base,
                    bbox,
                    segmentation: [seg],
                    area: polygonArea(anno.points)
                };
            }
        });

    try {
        const config = JSON.parse(document.getElementById('app-config').textContent);
        const imageFilename = decodeURIComponent(savedImageKey.split('/').pop());
        const response = await fetch('/annotation/save_annotations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project: config.projectName,
                image: imageFilename,
                annotations: cocoAnnotations,
                approve
            })
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || `Server error: ${response.status}`);
        }

        // Commit locally only after success, without overwriting edits made during the request.
        if (currentImageKey === savedImageKey && JSON.stringify(annotations) === originalAnnotations) {
            annotations.length = 0;
            annotations.push(...filteredAnnotations);
            annotationCache[savedImageKey] = [...filteredAnnotations];
            setIsModified(false);
            updateAnnotationSummary();
            saveCacheToStorage();
        }
        setImageApprovalState(savedImageKey, approve, !approve);
        if (typeof statusFn === 'function') statusFn(savedImageKey, approve);

        if (isAutoSave || isAdvanceAfterSaveEnabled) {
            showAutoSaveToast(isAutoSave ? 'Auto-saved' : 'Annotations saved');
        } else {
            const modal = document.getElementById('save-modal');
            if (modal) {
                modal.style.display = 'flex';
                setTimeout(() => {
                    modal.style.display = 'none';
                }, 3000);
            }
        }
        return true;
    } catch (error) {
        console.error('Save error:', error);
        if (isAutoSave) {
            showAutoSaveToast('Auto-save failed', true);
        } else {
            alert(`Failed to save annotations: ${error.message}`);
        }
        return false;
    }
}

export async function approveAndMaybeAdvance(updateAnnotationStatus = null) {
    if (manualSavePending || unapproveInFlight || saveInFlight) return;
    manualSavePending = true;
    const savedImageKey = currentImageKey;
    const buttons = ['approve-btn', 'save-btn'].map(id => document.getElementById(id)).filter(Boolean);
    buttons.forEach(button => { button.disabled = true; });
    try {
        const success = await executeSave(false, updateAnnotationStatus);
        if (success && isAdvanceAfterSaveEnabled && currentImageKey === savedImageKey && !isModified) {
            await navigateImage(1);
        }
    } finally {
        manualSavePending = false;
        syncApprovalButtons();
    }
}

export function initSaveHandling(updateAnnotationStatus) {
    currentUpdateAnnotationStatus = updateAnnotationStatus;
    const unapproveBtn = document.getElementById('unapprove-btn');
    if (unapproveBtn) unapproveBtn.addEventListener('click', () => unapproveCurrentImage());
    syncApprovalButtons();
    const approveBtn = document.getElementById('approve-btn');
    if (approveBtn) {
        approveBtn.addEventListener('click', async function(e) {
            if (e) e.preventDefault();
            await approveAndMaybeAdvance(updateAnnotationStatus);
        });
    }
}
