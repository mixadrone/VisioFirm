import { navigateImage } from './viewManagement.js';
import { mode, gridEnabled, selectedAnnotation, selectedAnnotations, setSelectedAnnotations, clearSelectedAnnotations, annotations, undoStack, viewport, currentImage, setupType, currentAnnotation, currentImageKey, thumbnailImages, currentImageIndex, setMode, setGridEnabled, setSelectedAnnotation, setSelectedPointIndex, setCurrentAnnotation, setAnnotations, setIsModified, updateTagHighlights } from './globals.js';
import { clampAnnotationToBounds, clampToImageBounds } from './annotationCore.js';
import { drawImage, resetView } from './annotationDrawing.js';
import { updateAnnotationSummary, selectImage } from './imageHandling.js';
import { pushToUndoStack } from './annotationCore.js';
import { updateToolModeUI, setIsDrawing, setIsDragging, setIsPanning } from './globals.js';

export function clearAllAnnotations() {
    if (!currentImageKey || (!annotations.length && !currentAnnotation)) return;
    pushToUndoStack();
    setAnnotations([]);
    setCurrentAnnotation(null);
    clearSelectedAnnotations();
    setSelectedPointIndex(-1);
    setIsDrawing(false);
    setIsDragging(false);
    setIsPanning(false);
    setIsModified(true);
    updateTagHighlights();
    updateAnnotationSummary();
    drawImage();
}

export function initToolControls() {
    let previousMode = setupType === 'Segmentation' ? 'polygon' : 'rect';
    document.getElementById('pan-mode')?.addEventListener('click', () => {
        if (mode === 'pan') setMode(previousMode);
        else {
            previousMode = mode;
            setMode('pan');
        }
    });
    document.getElementById('clear-annotations-btn')?.addEventListener('click', clearAllAnnotations);
    const rectBtn = document.getElementById('rect-mode');
    if (rectBtn) {
        rectBtn.addEventListener('click', () => {
            if (setupType === "Segmentation") return;
            setMode('rect'); // Use setter
            updateButtonStates();
        });
    }

    const polygonBtn = document.getElementById('polygon-mode');
    if (polygonBtn) {
        polygonBtn.addEventListener('click', () => {
            if (setupType !== "Segmentation") return;
            setMode('polygon'); // Use setter
            setSelectedAnnotation(null); // Use setter
            setCurrentAnnotation(null); // Use setter
            updateButtonStates();
        });
    }

    const selectBtn = document.getElementById('select-mode');
    if (selectBtn) {
        selectBtn.addEventListener('click', () => {
            setMode('select'); // Use setter
            updateButtonStates();
        });
    }

    const resetBtn = document.getElementById('reset-view');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetView);
    }

    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) {
        undoBtn.addEventListener('click', () => {
            if (undoStack[currentImageKey] && undoStack[currentImageKey].length > 0) { // Now defined
                setAnnotations(undoStack[currentImageKey].pop()); // Use setter
                setIsModified(true);
                setSelectedAnnotation(annotations.length > 0 ? annotations[annotations.length - 1] : null); // Use setter
                setSelectedPointIndex(-1);
                updateTagHighlights();
                updateAnnotationSummary();
                drawImage();
            }
        });
    }

    const deleteBtn = document.getElementById('delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            const toDelete = (selectedAnnotations && selectedAnnotations.length > 0) ? selectedAnnotations : (selectedAnnotation ? [selectedAnnotation] : []);
            if (toDelete.length > 0) {
                pushToUndoStack();
                setAnnotations(annotations.filter(a => !toDelete.includes(a)));
                clearSelectedAnnotations();
                setSelectedPointIndex(-1);
                setIsModified(true);
                updateTagHighlights();
                updateAnnotationSummary();
                drawImage();
            }
        });
    }

    const zoomInBtn = document.getElementById('zoom-in-btn');
    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', () => {
            viewport.zoom = Math.min(viewport.maxZoom, viewport.zoom * 1.1);
            drawImage();
        });
    }

    const zoomOutBtn = document.getElementById('zoom-out-btn');
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', () => {
            viewport.zoom = Math.max(viewport.minZoom, viewport.zoom * 0.9);
            drawImage();
        });
    }

    const duplicateBtn = document.getElementById('duplicate-btn');
    if (duplicateBtn) {
        duplicateBtn.addEventListener('click', () => {
            const toDuplicate = (selectedAnnotations && selectedAnnotations.length > 0) ? selectedAnnotations : (selectedAnnotation ? [selectedAnnotation] : []);
            if (toDuplicate.length > 0) {
                pushToUndoStack();
                const duplicates = toDuplicate.map(item => {
                    const dup = scaleAnnotation(item, currentImage.width, currentImage.height, currentImage.width, currentImage.height);
                    if (dup.type === 'rect' || dup.type === 'obbox') {
                        dup.x = (dup.x || 0) + 12;
                        dup.y = (dup.y || 0) + 12;
                        clampAnnotationToBounds(dup);
                    } else if (dup.type === 'polygon' && Array.isArray(dup.points)) {
                        dup.points = dup.points.map(p => clampToImageBounds({ x: p.x + 12, y: p.y + 12 }));
                    }
                    return dup;
                });
                setAnnotations([...annotations, ...duplicates]);
                setSelectedAnnotations(duplicates);
                updateTagHighlights();
                drawImage();
            }
        });
    }

    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            document.getElementById('approve-btn').click();
        });
    }

    const gridBtn = document.getElementById('grid-btn');
    if (gridBtn) {
        gridBtn.addEventListener('click', () => {
            setGridEnabled(!gridEnabled); // Use setter
            gridBtn.classList.toggle('active', gridEnabled);
            drawImage();
        });
    }

    const prevBtn = document.getElementById('prev-image-btn');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            navigateImage(-1);
        });
    }

    const nextBtn = document.getElementById('next-image-btn');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            navigateImage(1);
        });
    }

    const jumpInput = document.getElementById('image-jump-input');
    if (jumpInput) {
        const handleJump = () => {
            if (!thumbnailImages || thumbnailImages.length === 0) return;
            let targetNum = parseInt(jumpInput.value, 10);
            if (isNaN(targetNum)) {
                targetNum = (currentImageIndex >= 0 ? currentImageIndex : 0) + 1;
            }
            targetNum = Math.max(1, Math.min(thumbnailImages.length, targetNum));
            jumpInput.value = targetNum;
            const targetIdx = targetNum - 1;
            if (targetIdx !== currentImageIndex && thumbnailImages[targetIdx]) {
                selectImage(thumbnailImages[targetIdx], targetIdx);
            }
        };

        jumpInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleJump();
                jumpInput.blur();
            } else if (e.key === 'Escape') {
                jumpInput.value = (currentImageIndex >= 0 ? currentImageIndex : 0) + 1;
                jumpInput.blur();
            }
        });

        jumpInput.addEventListener('change', () => {
            handleJump();
        });

        jumpInput.addEventListener('focus', () => {
            jumpInput.select();
        });
    }

    // Optional buttons
    const magicModeBtn = document.getElementById('magic-mode');
    if (magicModeBtn) {
        magicModeBtn.addEventListener('click', () => {
            setMode('magic');
            updateButtonStates();
        });
    }

    // Hide buttons based on setupType
    const polygonModeBtn = document.getElementById('polygon-mode');
    const rectModeBtn = document.getElementById('rect-mode');
    if (setupType === "Bounding Box" || setupType === "Oriented Bounding Box") {
        if (polygonModeBtn) polygonModeBtn.style.display = 'none';
    } else if (setupType === "Segmentation") {
        if (rectModeBtn) rectModeBtn.style.display = 'none';
    }

    updateButtonStates();
}

function updateButtonStates() {
    updateToolModeUI();
}

function scaleAnnotation(annotation, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const scaleX = targetWidth / sourceWidth;
    const scaleY = targetHeight / sourceHeight;
    const scaled = JSON.parse(JSON.stringify(annotation));
    if (scaled.type === 'rect') {
        scaled.x *= scaleX;
        scaled.y *= scaleY;
        scaled.width *= scaleX;
        scaled.height *= scaleY;
    } else if (scaled.type === 'polygon') {
        scaled.points = scaled.points.map(p => ({
            x: p.x * scaleX,
            y: p.y * scaleY
        }));
    }
    return scaled;
}
