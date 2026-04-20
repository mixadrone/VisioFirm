import {
    currentImageKey,
    currentImage,
    currentImageIndex,
    annotations,
    annotationCache,
    undoStack,
    thumbnailImages,
    viewport,
    canvas,
    setupType,
    confidenceThreshold,
    setSelectedLabel,
    setCurrentImageKey,
    setCurrentImage,
    setAnnotations,
    setAnnotationCache,
    setUndoStack,
    setSelectedAnnotation,
    setCurrentImageIndex,
    updateTagHighlights,
    isAnnotationLabelHidden
} from './globals.js';
import { drawImage, resetView } from './annotationDrawing.js';
import { updateAnnotationStatus, updateClassTags } from './main.js';

export function updateAnnotationSummary() {
    const summary = document.getElementById('annotation-summary');
    if (!summary) return;

    const totalPreannotations = annotations.filter(anno => anno.isPreannotation).length;
    const shownPreannotations = annotations.filter(anno => (
        anno.isPreannotation &&
        anno.confidence >= confidenceThreshold &&
        !isAnnotationLabelHidden(anno.label)
    )).length;
    const hiddenByClass = annotations.filter(anno => anno.isPreannotation && isAnnotationLabelHidden(anno.label)).length;

    if (totalPreannotations === 0) {
        summary.textContent = 'AI: no preannotations';
        return;
    }

    const parts = [`AI: ${totalPreannotations} predicted`, `${shownPreannotations} shown`];
    if (hiddenByClass > 0) {
        parts.push(`${hiddenByClass} hidden by class`);
    }
    summary.textContent = parts.join(' | ');
}

function isAnnotationCurrentlyVisible(anno) {
    return (
        !isAnnotationLabelHidden(anno.label) &&
        (!anno.isPreannotation || anno.confidence >= confidenceThreshold)
    );
}

export async function selectImage(imgElement, index = -1) {
    if (!imgElement || !imgElement.getAttribute('src')) {
        console.error('Invalid image element provided to selectImage');
        return;
    }

    const img = new Image();
    let imageKey = imgElement.getAttribute('src');
    if (imageKey.startsWith('http')) {
        const url = new URL(imageKey);
        imageKey = url.pathname;
    }
    console.log('Selecting Image:', imageKey);

    if (currentImageKey) {
        setAnnotationCache({
            ...annotationCache,
            [currentImageKey]: [...annotations]
        });
    }

    img.onload = async () => {
        setCurrentImageKey(imageKey);
        setCurrentImageIndex(index >= 0 ? index : Array.from(thumbnailImages).indexOf(imgElement));
        setCurrentImage(img);

        let loadedAnnotations = [];
        let loadedPreannotations = [];
        let isReviewed = false;
        try {
            const projectName = JSON.parse(document.getElementById('app-config').textContent).projectName;
            const imagePath = imageKey.split('/').slice(-1)[0];
            console.log('Fetching annotations for:', imagePath);
            const response = await fetch(`/annotation/get_annotations/${projectName}/${encodeURIComponent(imagePath)}`);
            const result = await response.json();

            if (result.success) {
                loadedAnnotations = result.annotations.map(anno => ({
                    ...anno,
                    type: setupType === "Oriented Bounding Box" ? 'obbox' : anno.type,
                    rotation: anno.rotation || 0,
                    isPreannotation: false // Flag for regular annotations
                }));
                loadedPreannotations = result.preannotations.map(preanno => ({
                    ...preanno,
                    type: setupType === "Oriented Bounding Box" ? 'obbox' : preanno.type,
                    rotation: preanno.rotation || 0,
                    confidence: preanno.confidence,
                    isPreannotation: true // Flag for preannotations
                }));
                isReviewed = result.reviewed || false;
                console.log('Fetched Annotations:', loadedAnnotations);
                console.log('Fetched Preannotations:', loadedPreannotations);
                console.log('Reviewed:', isReviewed);
            } else {
                console.error('Failed to fetch annotations:', result.error);
            }
        } catch (error) {
            console.error('Error fetching annotations:', error);
        }

        // Combine into a single array
        const allAnnotations = [...loadedAnnotations, ...loadedPreannotations];

        if (setupType === 'Classification') {
            setAnnotations(allAnnotations);
            setSelectedAnnotation(null);
            if (allAnnotations.length > 0) {
                setSelectedLabel(allAnnotations[0].label);
                // Filter out preannotations if needed, or handle confidence
                const preanno = loadedPreannotations[0];
                if (preanno && preanno.confidence >= confidenceThreshold) {
                    // Optionally suggest preannotation, but for now, use loaded annotation
                }
            } else {
                setSelectedLabel(null);
            }
            updateClassTags(); // Refresh UI with selected label
        } else {
            setAnnotations(allAnnotations);

            // Select the first annotation to show handles
            const firstVisibleAnnotation = allAnnotations.find(isAnnotationCurrentlyVisible) || null;
            setSelectedAnnotation(firstVisibleAnnotation);
            updateTagHighlights();
        }

        const cachedAnnotations = annotationCache[imageKey] || [];
        if (cachedAnnotations.length > 0) {
            const updatedCachedAnnotations = cachedAnnotations.map(anno => ({
                ...anno,
                type: setupType === "Oriented Bounding Box" ? 'obbox' : anno.type,
                rotation: anno.rotation || 0,
                isPreannotation: anno.isPreannotation || false // Preserve flag if cached
            }));
            if (setupType === 'Classification') {
                setAnnotations(updatedCachedAnnotations);
                setSelectedAnnotation(null);
                if (updatedCachedAnnotations.length > 0) {
                    setSelectedLabel(updatedCachedAnnotations[0].label);
                    updateClassTags();
                } else {
                    setSelectedLabel(null);
                }
            } else {
                setAnnotations(updatedCachedAnnotations);
                const firstVisibleCachedAnnotation = updatedCachedAnnotations.find(isAnnotationCurrentlyVisible) || null;
                setSelectedAnnotation(firstVisibleCachedAnnotation);
                console.log('Using cached annotations:', updatedCachedAnnotations);
            }
        }

        setUndoStack({
            ...undoStack,
            [imageKey]: undoStack[imageKey] || []
        });

        resizeCanvas();

        const filename = imageKey.split('/').pop();
        // Try to find an image id from the thumbnail/grid DOM data attributes
        let imageId = null;
        try {
            const idHolder = imgElement.closest('[data-image-id]') || document.querySelector(`.thumbnail-row[data-id="${filename}"]`) || document.querySelector(`.grid-card[data-id="${filename}"]`) || document.querySelector(`#list-table tr[data-id="${filename}"]`);
            if (idHolder) imageId = idHolder.getAttribute('data-image-id') || null;
        } catch (err) {
            console.warn('Error finding image id element:', err);
            imageId = null;
        }
        const isAnnotated = loadedAnnotations.length > 0 || isReviewed;
        const isPreannotated = loadedPreannotations.length > 0 && !isAnnotated;
        updateAnnotationStatus(imageKey, isAnnotated, isPreannotated);

        const statusElement = document.querySelector(`[data-id="${filename}"] .image-status`);
        if (statusElement) {
            statusElement.textContent = isAnnotated ? 'Annotated' : (isPreannotated ? 'Pre-Annotated' : 'Not Annotated');
            statusElement.dataset.annotated = isAnnotated ? 'true' : 'false';
            statusElement.dataset.preannotated = isPreannotated ? 'true' : 'false';
        }

        const imageInfoText = document.querySelector('.image-info-text');
        if (imageInfoText) {
            if (imageId) {
                imageInfoText.textContent = `ID: ${imageId} | ${filename} | Resolution: ${currentImage.width}x${currentImage.height}`;
            } else {
                imageInfoText.textContent = `${filename} | Resolution: ${currentImage.width}x${currentImage.height}`;
            }
        }
        updateAnnotationSummary();
        drawImage();

        document.querySelectorAll('.thumbnail-row').forEach(row => row.classList.remove('selected'));
        const annotationRow = document.querySelector(`.thumbnail-row[data-id="${filename}"]`);
        if (annotationRow) {
            annotationRow.classList.add('selected');
            annotationRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            console.warn(`No thumbnail-row found with data-id: ${filename}`);
        }
    };

    img.src = imageKey;

    document.querySelectorAll('.grid-card').forEach(card => card.classList.remove('selected'));
    const gridCard = imgElement.closest('.grid-card');
    if (gridCard) gridCard.classList.add('selected');
}

export function resizeCanvas() {
    if (!currentImage || !currentImageKey) return;
    const container = document.querySelector('.image-container');
    const imageInfo = container?.querySelector('.image-info');
    if (!container) {
        console.error('Container element not found');
        return;
    }
    const availableWidth = container.clientWidth;
    const infoHeight = imageInfo ? imageInfo.offsetHeight : 0;
    const availableHeight = Math.max(0, container.clientHeight - infoHeight);
    const widthScale = availableWidth / currentImage.width;
    const heightScale = availableHeight / currentImage.height;
    const fitZoom = Math.min(widthScale, heightScale) * 0.9;

    canvas.width = availableWidth;
    canvas.height = availableHeight;
    viewport.fitZoom = fitZoom;
    viewport.minZoom = fitZoom * 0.5;
    viewport.zoom = Math.max(viewport.minZoom, viewport.zoom);
    resetView();
}

// Single-image delete handler: deletes currently selected image from project using modal confirmation
document.addEventListener('DOMContentLoaded', () => {
    const deleteBtn = document.getElementById('delete-image-btn');
    const singleDeleteModal = document.getElementById('delete-single-confirm-modal');
    const singleDeleteMsg = singleDeleteModal && singleDeleteModal.querySelector('#delete-single-message');
    const confirmSingleDelete = singleDeleteModal && singleDeleteModal.querySelector('#confirm-delete-single');
    const cancelSingleDelete = singleDeleteModal && singleDeleteModal.querySelector('#cancel-delete-single');
    const cancelSingleDeleteFooter = singleDeleteModal && singleDeleteModal.querySelector('#cancel-delete-single-footer');
    const headerCloseSingle = singleDeleteModal && singleDeleteModal.querySelector('.close-btn#cancel-delete-single');

    if (!deleteBtn || !singleDeleteModal || !confirmSingleDelete || !cancelSingleDelete) return;

    let pendingImageKey = null;

    deleteBtn.addEventListener('click', (e) => {
        if (!currentImageKey) {
            alert('No image selected');
            return;
        }
        pendingImageKey = currentImageKey;
        const filename = pendingImageKey.split('/').pop();
        singleDeleteMsg.textContent = `Are you sure you want to delete ${filename}? This action cannot be undone.`;
        singleDeleteModal.style.display = 'flex';
    });

    const closeModal = () => {
        singleDeleteModal.style.display = 'none';
        pendingImageKey = null;
    };

    if (cancelSingleDelete) cancelSingleDelete.addEventListener('click', () => closeModal());
    if (cancelSingleDeleteFooter) cancelSingleDeleteFooter.addEventListener('click', () => closeModal());
    if (headerCloseSingle) headerCloseSingle.addEventListener('click', () => closeModal());

    confirmSingleDelete.addEventListener('click', async () => {
        if (!pendingImageKey) return closeModal();
        const filename = pendingImageKey.split('/').pop();
        const conf = JSON.parse(document.getElementById('app-config').textContent);
        const projectName = conf.projectName;

        // Determine target filename (next or previous) BEFORE removing DOM nodes
        const thumbRows = Array.from(document.querySelectorAll('.thumbnail-row'));
        let currentIndex = -1;
        for (let i = 0; i < thumbRows.length; i++) {
            if (thumbRows[i].dataset.id === filename) {
                currentIndex = i;
                break;
            }
        }
        let targetFilename = null;
        if (currentIndex >= 0) {
            if (currentIndex < thumbRows.length - 1) {
                targetFilename = thumbRows[currentIndex + 1].dataset.id;
            } else if (currentIndex > 0) {
                targetFilename = thumbRows[currentIndex - 1].dataset.id;
            }
        }

        try {
            const resp = await fetch('/annotation/delete_images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project: projectName, images: [pendingImageKey] })
            });
            const result = await resp.json();
            if (result.success) {
                // Remove DOM nodes for this image
                document.querySelectorAll(`.grid-card[data-id="${filename}"]`).forEach(n => n.remove());
                document.querySelectorAll(`.thumbnail-row[data-id="${filename}"]`).forEach(n => n.remove());
                document.querySelectorAll(`#list-table tr[data-id="${filename}"]`).forEach(n => n.remove());

                // If we found a target filename, navigate to same page with focus param to load that image
                if (targetFilename) {
                    const url = new URL(window.location.href);
                    url.searchParams.set('focus', targetFilename);
                    window.location.href = url.toString();
                    return; // page will reload
                }

                // no target — reload current page (will show empty state)
                window.location.reload();
            } else {
                alert(result.error || 'Failed to delete image');
            }
        } catch (err) {
            console.error('Delete image error:', err);
            alert('Failed to delete image');
        } finally {
            closeModal();
        }
    });
});
