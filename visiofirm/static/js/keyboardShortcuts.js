import { navigateImage } from './viewManagement.js';
// Updated keyboardShortcuts.js with additional check for annotation-view visibility

import {
    selectedAnnotation,
    selectedAnnotations,
    setSelectedAnnotations,
    clearSelectedAnnotations,
    setupType,
    annotations,
    undoStack,
    currentAnnotation,
    mode,
    currentImage,
    viewport,
    currentImageKey,
    setSelectedAnnotation,
    setSelectedPointIndex,
    setAnnotations,
    setCurrentAnnotation,
    setMode,
    clipboardImageResolution,
    setClipboardImageResolution,
    setIsRotating,
    isRotating,
    setIsModified,
    setSelectedClass,
    updateTagHighlights
} from './globals.js';
import { drawImage, resetView } from './annotationDrawing.js';
import { updateAnnotationSummary } from './imageHandling.js';
import { pushToUndoStack, clampToImageBounds, clampAnnotationToBounds } from './annotationCore.js';

let shortcutsInitialized = false;

export function initKeyboardShortcuts() {
    if (shortcutsInitialized) return;
    shortcutsInitialized = true;
    document.addEventListener('keydown', (e) => {
        // Check if we are in annotation-view; if not, skip all shortcuts
        const annotationView = document.getElementById('annotation-view');
        if (!annotationView || !annotationView.classList.contains('show')) {
            return;
        }

        // Skip all custom shortcuts if focus is on an input, textarea, or contenteditable element.
        // This allows default browser behavior (e.g., typing, arrow navigation in text) without interference.
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) {
            return; // Do nothing; let the default key behavior happen.
        }

        if (e.ctrlKey && e.key === 'a') {
            e.preventDefault();
            setSelectedAnnotation(null);
            setSelectedPointIndex(-1);
            drawImage();
        }
        else if (e.ctrlKey && e.key === 'c') {
            e.preventDefault();
            const toCopy = (selectedAnnotations && selectedAnnotations.length > 0) ? selectedAnnotations : (selectedAnnotation ? [selectedAnnotation] : []);
            if (toCopy.length > 0) {
                const copyText = JSON.stringify(toCopy);
                navigator.clipboard.writeText(copyText).then(() => {
                    setClipboardImageResolution({ width: currentImage.width, height: currentImage.height });
                    console.log('Annotations copied to clipboard:', toCopy.length);
                }).catch(err => {
                    console.error('Failed to copy annotation: ', err);
                });
            }
        }
        else if (e.ctrlKey && e.key === 'v') {
            e.preventDefault();
            navigator.clipboard.readText().then(text => {
                try {
                    const parsed = JSON.parse(text);
                    const items = Array.isArray(parsed) ? parsed : (parsed && parsed.type ? [parsed] : []);
                    if (items.length > 0) {
                        pushToUndoStack();
                        const newItems = items.map(item => {
                            const scaled = scaleAnnotation(
                                item,
                                clipboardImageResolution.width, clipboardImageResolution.height,
                                currentImage.width, currentImage.height
                            );
                            if (scaled.type === 'rect' || scaled.type === 'obbox') {
                                scaled.x = (scaled.x || 0) + 10;
                                scaled.y = (scaled.y || 0) + 10;
                                clampAnnotationToBounds(scaled);
                            } else if (scaled.type === 'polygon' && Array.isArray(scaled.points)) {
                                scaled.points = scaled.points.map(p => clampToImageBounds({ x: p.x + 10, y: p.y + 10 }));
                            }
                            return scaled;
                        });
                        setAnnotations([...annotations, ...newItems]);
                        setSelectedAnnotations(newItems);
                        updateTagHighlights();
                        drawImage();
                    }
                } catch (err) {
                    console.error('Failed to paste annotation: ', err);
                }
            }).catch(err => {
                console.error('Failed to read clipboard contents: ', err);
            });
        }
        else if (e.ctrlKey && e.key === 'd') {
            e.preventDefault();
            const toDuplicate = (selectedAnnotations && selectedAnnotations.length > 0) ? selectedAnnotations : (selectedAnnotation ? [selectedAnnotation] : []);
            if (toDuplicate.length > 0) {
                pushToUndoStack();
                const duplicates = toDuplicate.map(item => {
                    const dup = scaleAnnotation(
                        item,
                        currentImage.width, currentImage.height,
                        currentImage.width, currentImage.height
                    );
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
        }
        else if (e.ctrlKey && e.key === 'z' && currentImageKey && undoStack[currentImageKey]?.length > 0) {
            e.preventDefault();
            const newStack = undoStack[currentImageKey];
            const lastState = newStack.pop();
            setAnnotations(lastState);
            setIsModified(true);
            setSelectedAnnotation(lastState.length > 0 ? lastState[lastState.length - 1] : null);
            setSelectedPointIndex(-1);
            updateTagHighlights();
            updateAnnotationSummary();
            drawImage();
        }
        else if (e.key === 'Delete' && (selectedAnnotations.length > 0 || selectedAnnotation)) {
            e.preventDefault();
            const toDelete = selectedAnnotations.length > 0 ? selectedAnnotations : [selectedAnnotation];
            pushToUndoStack();
            const newAnnotations = annotations.filter(a => !toDelete.includes(a));
            setAnnotations(newAnnotations);
            clearSelectedAnnotations();
            setSelectedPointIndex(-1);
            setIsModified(true);
            updateTagHighlights();
            updateAnnotationSummary();
            drawImage();
        }
        else if (e.key === 'Escape') {
            e.preventDefault();
            if (currentAnnotation) {
                if (currentAnnotation.points?.length > 2) {
                    currentAnnotation.closed = true;
                    pushToUndoStack();
                    setAnnotations([...annotations, currentAnnotation]);
                    setSelectedAnnotation(currentAnnotation);
                }
                setCurrentAnnotation(null);
                drawImage();
            } else if (selectedAnnotations && selectedAnnotations.length > 0) {
                clearSelectedAnnotations();
                setSelectedPointIndex(-1);
                updateTagHighlights();
                drawImage();
            }
        }
        else if (e.key === 'r' && setupType === "Oriented Bounding Box" && selectedAnnotation && (selectedAnnotation.type === 'rect' || selectedAnnotation.type === 'obbox')) {
            e.preventDefault();
            setIsRotating(!isRotating);
            drawImage();
        }
        else if (e.key === 'r' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            if (setupType !== "Segmentation") {
                setMode('rect');
                setCurrentAnnotation(null);
                drawImage();
            }
        }
        else if ((e.code === 'KeyS' || e.key.toLowerCase() === 's' || e.key === 'Enter') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
            // Leave Enter to focused controls and modal dialogs.
            if (e.target.closest?.('[role="dialog"], .modal, #annotation-style-modal')) return;
            if (e.key === 'Enter' && e.target.closest?.('button, a, select')) return;
            e.preventDefault();
            if (!e.repeat) document.getElementById('approve-btn').click();
        }
        else if (!e.ctrlKey && e.key === 'ArrowRight') {
            e.preventDefault();
            // Holding an arrow must not queue additional image switches while loading.
            if (!e.repeat) navigateImage(1);
        }
        else if (!e.ctrlKey && e.key === 'ArrowLeft') {
            e.preventDefault();
            if (!e.repeat) navigateImage(-1);
        }
        else if (e.ctrlKey && selectedAnnotation && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            pushToUndoStack();
            const nudge = 1 / viewport.zoom;
            const updatedAnnotation = { ...selectedAnnotation };
            if (updatedAnnotation.type === 'rect' || updatedAnnotation.type === 'obbox') {
                if (e.key === 'ArrowUp') updatedAnnotation.y -= nudge;
                else if (e.key === 'ArrowDown') updatedAnnotation.y += nudge;
                else if (e.key === 'ArrowLeft') updatedAnnotation.x -= nudge;
                else if (e.key === 'ArrowRight') updatedAnnotation.x += nudge;
            } else if (updatedAnnotation.type === 'polygon') {
                updatedAnnotation.points = updatedAnnotation.points.map(p => {
                    if (e.key === 'ArrowUp') return { x: p.x, y: p.y - nudge };
                    else if (e.key === 'ArrowDown') return { x: p.x, y: p.y + nudge };
                    else if (e.key === 'ArrowLeft') return { x: p.x - nudge, y: p.y };
                    else if (e.key === 'ArrowRight') return { x: p.x + nudge, y: p.y };
                    return p;
                });
            }
            setAnnotations(annotations.map(a => a === selectedAnnotation ? updatedAnnotation : a));
            setSelectedAnnotation(updatedAnnotation);
            drawImage();
        }
        else if (e.key === 'p' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            if (setupType === "Segmentation") {
                setMode('polygon');
                setSelectedAnnotation(null);
                setCurrentAnnotation(null);
                drawImage();
            }
        }
        else if ((e.code === 'KeyV' || e.key.toLowerCase() === 'v') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
            e.preventDefault();
            setMode('select');
            drawImage();
        }
        else if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            resetView();
        }
        else if (e.key === 'g' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            import('./globals.js').then(module => {
                module.setGridEnabled(!module.gridEnabled);
                drawImage();
            });
        }
        else if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            const configEl = document.getElementById('app-config');
            if (configEl) {
                try {
                    const config = JSON.parse(configEl.textContent);
                    const classIdx = parseInt(e.key, 10) - 1;
                    if (Array.isArray(config.classes) && classIdx >= 0 && classIdx < config.classes.length) {
                        const targetClass = config.classes[classIdx];
                        if (selectedAnnotations && selectedAnnotations.length > 0) {
                            pushToUndoStack();
                            selectedAnnotations.forEach(ann => { ann.label = targetClass; });
                            setSelectedClass(targetClass);
                            drawImage();
                            updateTagHighlights();
                        } else if (selectedAnnotation) {
                            pushToUndoStack();
                            selectedAnnotation.label = targetClass;
                            setSelectedClass(targetClass);
                            drawImage();
                            updateTagHighlights();
                        } else {
                            setSelectedClass(targetClass);
                            updateTagHighlights();
                        }
                    }
                } catch (err) {
                    console.error('Error selecting class via shortcut:', err);
                }
            }
        }
    });

    document.addEventListener('keyup', (e) => {
        // Check if we are in annotation-view; if not, skip
        const annotationView = document.getElementById('annotation-view');
        if (!annotationView || !annotationView.classList.contains('show')) {
            return;
        }

        // Apply the same input focus check for keyup events as well.
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) {
            return;
        }

        if (e.key === 'r' && setupType === "Oriented Bounding Box") {
            setIsRotating(false);
            drawImage();
        }
    });
}

function scaleAnnotation(annotation, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const scaleX = targetWidth / sourceWidth;
    const scaleY = targetHeight / sourceHeight;
    const scaled = JSON.parse(JSON.stringify(annotation));
    if (scaled.type === 'rect' || scaled.type === 'obbox') {
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
