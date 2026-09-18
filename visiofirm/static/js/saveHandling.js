import { annotationCache, currentImageKey, annotations, confidenceThreshold, setIsModified, isModified, isAdvanceAfterSaveEnabled } from './globals.js';
import { saveCacheToStorage } from './storageHandling.js';
import { updateAnnotationSummary } from './imageHandling.js';
import { navigateImage } from './viewManagement.js';

let currentUpdateAnnotationStatus = null;
let toastTimeout = null;
let saveInFlight = null;
let manualSavePending = false;

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
    if (saveInFlight) return saveInFlight;
    saveInFlight = performSave(isAutoSave, updateAnnotationStatus).finally(() => { saveInFlight = null; });
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
                approve: true
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
        if (typeof statusFn === 'function') statusFn(savedImageKey, true);

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
    if (manualSavePending) return;
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
        buttons.forEach(button => { button.disabled = false; });
    }
}

export function initSaveHandling(updateAnnotationStatus) {
    currentUpdateAnnotationStatus = updateAnnotationStatus;
    const approveBtn = document.getElementById('approve-btn');
    if (approveBtn) {
        approveBtn.addEventListener('click', async function(e) {
            if (e) e.preventDefault();
            await approveAndMaybeAdvance(updateAnnotationStatus);
        });
    }
}

function polygonArea(points) {
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
    }
    return Math.abs(area / 2);
}
