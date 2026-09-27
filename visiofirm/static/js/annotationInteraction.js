import { 
    canvas,
    viewport,
    currentImage,
    mode,
    annotations,
    currentAnnotation,
    isDrawing,
    isDragging,
    startX,
    startY,
    selectedAnnotation,
    selectedAnnotations,
    setSelectedAnnotation,
    setSelectedAnnotations,
    addSelectedAnnotation,
    removeSelectedAnnotation,
    toggleSelectedAnnotation,
    clearSelectedAnnotations,
    isAnnotationSelected,
    isSelectingMarquee,
    setIsSelectingMarquee,
    marqueeRect,
    setMarqueeRect,
    selectedPointIndex,
    setSelectedPointIndex,
    isRightClickEditing,
    setIsRightClickEditing,
    setupType,
    setIsDrawing,
    setCurrentAnnotation,
    setIsDragging,
    setStartX,
    setStartY,
    setInitialRotation,
    setInitialCorners,
    initialBox,
    setInitialBox,
    isPanning,
    setIsPanning,
    isRotating,
    setIsRotating,
    selectedClass,
    updateTagHighlights,
    confidenceThreshold,
    isAnnotationLabelHidden
} from './globals.js';
import { drawImage } from './annotationDrawing.js';
import { setHoveredAnnotation } from './annotationDrawing.js';
import { toImageCoords, toCanvasCoords, clampToImageBounds, pushToUndoStack, clampAnnotationToBounds, isAnnotationIntersectingBox, getRotatedCorners } from './annotationCore.js';
import { segmentArea } from './sam.js';

let pendingDrawStart = null;
let dragUndoRecorded = false;

function beginAnnotationDrag(annotation) {
    dragUndoRecorded = false;
    setInitialBox(annotation.type === 'rect' || annotation.type === 'obbox'
        ? { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height }
        : null);
}

export function getMousePos(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

export function isPointInAnnotation(point, annotation) {
    const imgPoint = toImageCoords(point.x, point.y);
    if (annotation.type === 'rect' || annotation.type === 'obbox') {
        const centerX = annotation.x + annotation.width / 2;
        const centerY = annotation.y + annotation.height / 2;
        const dx = imgPoint.x - centerX;
        const dy = imgPoint.y - centerY;
        const rad = (annotation.rotation || 0) * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const localX = dx * cos + dy * sin;
        const localY = -dx * sin + dy * cos;
        const halfW = annotation.width / 2;
        const halfH = annotation.height / 2;
        return localX >= -halfW && localX <= halfW && localY >= -halfH && localY <= halfH;
    } else if (annotation.type === 'polygon') {
        let inside = false;
        for (let i = 0, j = annotation.points.length - 1; i < annotation.points.length; j = i++) {
            const xi = annotation.points[i].x, yi = annotation.points[i].y;
            const xj = annotation.points[j].x, yj = annotation.points[j].y;
            const intersect = ((yi > imgPoint.y) !== (yj > imgPoint.y)) &&
                (imgPoint.x < (xj - xi) * (imgPoint.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }
    return false;
}

function isAnnotationVisible(anno) {
    return (
        (!anno.isPreannotation || anno.confidence >= confidenceThreshold) &&
        !isAnnotationLabelHidden(anno.label)
    );
}

export function findSelectedAnnotation(point) {
    // 1. Check handles only on the currently active annotation when exactly 1 is selected
    if (selectedAnnotations && selectedAnnotations.length === 1 && selectedAnnotation) {
        const annotation = selectedAnnotation;
        if (isAnnotationVisible(annotation)) {
            if (annotation.type === 'rect' || annotation.type === 'obbox') {
                const centerX = annotation.x + annotation.width / 2;
                const centerY = annotation.y + annotation.height / 2;
                const canvasCenter = toCanvasCoords(centerX, centerY);
                const halfWidth = annotation.width * viewport.zoom / 2;
                const halfHeight = annotation.height * viewport.zoom / 2;
                const rad = (annotation.rotation || 0) * Math.PI / 180;
                const corners = [
                    { x: -halfWidth, y: -halfHeight },
                    { x: halfWidth, y: -halfHeight },
                    { x: -halfWidth, y: halfHeight },
                    { x: halfWidth, y: halfHeight }
                ].map(corner => {
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);
                    const x = canvasCenter.x + (corner.x * cos - corner.y * sin);
                    const y = canvasCenter.y + (corner.x * sin + corner.y * cos);
                    return { x, y };
                });
                const edges = [
                    { x: 0, y: -halfHeight },
                    { x: 0, y: halfHeight },
                    { x: -halfWidth, y: 0 },
                    { x: halfWidth, y: 0 }
                ].map(edge => {
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);
                    const x = canvasCenter.x + (edge.x * cos - edge.y * sin);
                    const y = canvasCenter.y + (edge.x * sin + edge.y * cos);
                    return { x, y };
                });
                if (setupType === "Oriented Bounding Box") {
                    const rotationHandle = { x: 0, y: -halfHeight - 20/viewport.zoom };
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);
                    const rotX = canvasCenter.x + (rotationHandle.x * cos - rotationHandle.y * sin);
                    const rotY = canvasCenter.y + (rotationHandle.x * sin + rotationHandle.y * cos);
                    const distance = Math.sqrt(Math.pow(point.x - rotX, 2) + Math.pow(point.y - rotY, 2));
                    if (distance < 12) {
                        setSelectedPointIndex(-2);
                        setIsRotating(true);
                        return annotation;
                    }
                }
                for (let j = 0; j < corners.length; j++) {
                    const distance = Math.sqrt(Math.pow(point.x - corners[j].x, 2) + Math.pow(point.y - corners[j].y, 2));
                    if (distance < 12) {
                        setSelectedPointIndex(j);
                        return annotation;
                    }
                }
                for (let j = 0; j < edges.length; j++) {
                    const distance = Math.sqrt(Math.pow(point.x - edges[j].x, 2) + Math.pow(point.y - edges[j].y, 2));
                    if (distance < 12) {
                        setSelectedPointIndex(j + 4);
                        return annotation;
                    }
                }
            } else if (annotation.type === 'polygon') {
                for (let j = 0; j < annotation.points.length; j++) {
                    const p = toCanvasCoords(annotation.points[j].x, annotation.points[j].y);
                    const distance = Math.sqrt(Math.pow(point.x - p.x, 2) + Math.pow(point.y - p.y, 2));
                    if (distance < 12) {
                        setSelectedPointIndex(j);
                        return annotation;
                    }
                }
            }
        }
    }

    // 2. Check hit inside any visible annotation body (from top to bottom)
    // Pure lookup: DO NOT mutate selectedAnnotations here so group selection is preserved!
    for (let i = annotations.length - 1; i >= 0; i--) {
        const annotation = annotations[i];
        if (!isAnnotationVisible(annotation)) continue;
        if (isPointInAnnotation(point, annotation)) {
            setSelectedPointIndex(-1);
            return annotation;
        }
    }
    return null;
}

function findHoveredAnnotation(point) {
    for (let i = annotations.length - 1; i >= 0; i--) {
        const annotation = annotations[i];
        if (!isAnnotationVisible(annotation)) continue; // Skip invisible annotations
        if (isPointInAnnotation(point, annotation)) {
            return annotation;
        }
    }
    return null;
}

function findClosestPolygonSegment(polygon, point) {
    let minDist = Infinity;
    let closestSegment = -1;
    for (let i = 0; i < polygon.points.length - 1; i++) {
        const p1 = polygon.points[i];
        const p2 = polygon.points[i + 1];
        const dist = pointLineDistance(point, p1, p2);
        if (dist < minDist) {
            minDist = dist;
            closestSegment = i;
        }
    }
    if (polygon.closed && polygon.points.length > 2) {
        const dist = pointLineDistance(point, polygon.points[polygon.points.length - 1], polygon.points[0]);
        if (dist < minDist) {
            minDist = dist;
            closestSegment = polygon.points.length - 1;
        }
    }
    return closestSegment;
}

function pointLineDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lenSquared = dx * dx + dy * dy;
    if (lenSquared === 0) return Math.sqrt(Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2));
    let t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSquared;
    t = Math.max(0, Math.min(1, t));
    const nearestX = lineStart.x + t * dx;
    const nearestY = lineStart.y + t * dy;
    return Math.sqrt(Math.pow(point.x - nearestX, 2) + Math.pow(point.y - nearestY, 2));
}

function handleMouseDown(e) {
    const pos = getMousePos(canvas, e);
    const imgPos = toImageCoords(pos.x, pos.y);

    if (mode === 'magic' && e.button === 0) {
        const clampedPos = clampToImageBounds(imgPos);
        segmentArea(clampedPos);
        return;
    }

    // The middle button pans temporarily; the Pan tool also enables left-button panning.
    if (e.button === 1 || (mode === 'pan' && e.button === 0)) {
        e.preventDefault();
        setIsPanning(true);
        setStartX(pos.x - viewport.x);
        setStartY(pos.y - viewport.y);
        canvas.style.cursor = 'grabbing';
        return;
    }

    if (e.button === 2 && !e.shiftKey) {
        const clickedAnnotation = findSelectedAnnotation(pos);
        if (clickedAnnotation) {
            setSelectedAnnotation(clickedAnnotation);
            updateTagHighlights();
            setIsDragging(true);
            setIsRightClickEditing(true);
            setStartX(pos.x);
            setStartY(pos.y);
            beginAnnotationDrag(clickedAnnotation);
            if (clickedAnnotation.type === 'rect' || clickedAnnotation.type === 'obbox') {
                setInitialBox({
                    x: clickedAnnotation.x,
                    y: clickedAnnotation.y,
                    width: clickedAnnotation.width,
                    height: clickedAnnotation.height
                });
                if (selectedPointIndex >= 0) {
                    const theta = (clickedAnnotation.rotation || 0) * Math.PI / 180;
                    const cosTheta = Math.cos(theta);
                    const sinTheta = Math.sin(theta);
                    const centerX = clickedAnnotation.x + clickedAnnotation.width / 2;
                    const centerY = clickedAnnotation.y + clickedAnnotation.height / 2;
                    const localCorners = [
                        { x: -clickedAnnotation.width / 2, y: -clickedAnnotation.height / 2 },
                        { x: clickedAnnotation.width / 2, y: -clickedAnnotation.height / 2 },
                        { x: clickedAnnotation.width / 2, y: clickedAnnotation.height / 2 },
                        { x: -clickedAnnotation.width / 2, y: clickedAnnotation.height / 2 }
                    ];
                    const imageCorners = localCorners.map(local => {
                        const dx = local.x * cosTheta - local.y * sinTheta;
                        const dy = local.x * sinTheta + local.y * cosTheta;
                        return { x: centerX + dx, y: centerY + dy };
                    });
                    setInitialCorners(imageCorners);
                    setInitialRotation(clickedAnnotation.rotation || 0);
                }
            }
            drawImage();
            return;
        } else if (selectedAnnotation && e.ctrlKey && selectedAnnotation.type === 'polygon') {
            const segmentIndex = findClosestPolygonSegment(selectedAnnotation, imgPos);
            if (segmentIndex >= 0) {
                pushToUndoStack();
                selectedAnnotation.points.splice(segmentIndex + 1, 0, clampToImageBounds(imgPos));
            } else {
                pushToUndoStack();
                selectedAnnotation.points.push(clampToImageBounds(imgPos));
            }
            drawImage();
            return;
        } else {
            // RMB on empty space: clear selection
            setSelectedAnnotation(null);
            setSelectedPointIndex(-1);
            setInitialBox(null);
            updateTagHighlights();
            drawImage();
            return;
        }
    }

    // Shift is now dedicated to Selection operations (Add to selection / Marquee add)

    if (mode === 'rect' && e.button === 0) {
        if (e.shiftKey) {
            const clickedAnnotation = findSelectedAnnotation(pos);
            if (clickedAnnotation) {
                addSelectedAnnotation(clickedAnnotation);
                updateTagHighlights();
                setIsDragging(true);
                setStartX(pos.x);
                setStartY(pos.y);
                beginAnnotationDrag(clickedAnnotation);
                drawImage();
                return;
            } else {
                // Shift + drag on empty space in rect mode starts marquee Add (+)
                setIsSelectingMarquee(true);
                setMarqueeRect({
                    startX: pos.x,
                    startY: pos.y,
                    currentX: pos.x,
                    currentY: pos.y,
                    op: 'add',
                    initialOp: 'add'
                });
                setStartX(pos.x);
                setStartY(pos.y);
                drawImage();
                return;
            }
        }
        const clickedAnnotation = findSelectedAnnotation(pos);
        if (clickedAnnotation) {
            pendingDrawStart = null;
            setCurrentAnnotation(null);
            setIsDrawing(false);
            if (!isAnnotationSelected(clickedAnnotation) || selectedAnnotations.length <= 1) {
                setSelectedAnnotation(clickedAnnotation);
            }
            updateTagHighlights();
            setIsDragging(true);
            setStartX(pos.x);
            setStartY(pos.y);
            beginAnnotationDrag(clickedAnnotation);
            drawImage();
            return;
        }
        setSelectedAnnotation(null);
        setSelectedPointIndex(-1);
        updateTagHighlights();
        const clampedPos = clampToImageBounds(imgPos);
        if (e.altKey && setupType === "Oriented Bounding Box") {
            if (selectedAnnotation && (selectedAnnotation.type === 'rect' || selectedAnnotation.type === 'obbox')) {
                setIsDragging(true);
                setStartX(pos.x);
                setStartY(pos.y);
                return;
            }
        } else if (e.ctrlKey && e.shiftKey) {
            const defaultSize = 50;
            const newAnnotation = {
                type: setupType === "Oriented Bounding Box" ? 'obbox' : 'rect',
                x: clampedPos.x - defaultSize / 2,
                y: clampedPos.y - defaultSize / 2,
                width: defaultSize,
                height: defaultSize,
                rotation: 0,
                label: selectedClass
            };
            pushToUndoStack();
            annotations.push(newAnnotation);
            setSelectedAnnotation(newAnnotation);
            updateTagHighlights();
            setCurrentAnnotation(null);
            setIsDrawing(false);
            drawImage();
        } else {
            // LMB on empty space starts a new bounding box
            // Box creation is deferred until dragging exceeds movement threshold
            pendingDrawStart = {
                startX: pos.x,
                startY: pos.y,
                origX: clampedPos.x,
                origY: clampedPos.y
            };
            setCurrentAnnotation(null);
            setIsDrawing(false);
            drawImage();
        }
    }

    else if (mode === 'polygon' && e.button === 0) {
        if (!currentAnnotation) {
            const clickedAnnotation = findSelectedAnnotation(pos);
            if (clickedAnnotation) {
                if (e.shiftKey) {
                    addSelectedAnnotation(clickedAnnotation);
                } else if (!isAnnotationSelected(clickedAnnotation) || selectedAnnotations.length <= 1) {
                    setSelectedAnnotation(clickedAnnotation);
                }
                updateTagHighlights();
                setIsDragging(true);
                setStartX(pos.x);
                setStartY(pos.y);
                beginAnnotationDrag(clickedAnnotation);
                drawImage();
                return;
            }
            setSelectedAnnotation(null);
            setSelectedPointIndex(-1);
            updateTagHighlights();
            setCurrentAnnotation({
                type: 'polygon',
                points: [clampToImageBounds(imgPos)],
                closed: false,
                label: selectedClass
            });
        } else {
            const firstPoint = currentAnnotation.points[0];
            const firstCanvasPoint = toCanvasCoords(firstPoint.x, firstPoint.y);
            if (Math.abs(pos.x - firstCanvasPoint.x) < 10 && Math.abs(pos.y - firstCanvasPoint.y) < 10) {
                currentAnnotation.closed = true;
                if (currentAnnotation.points.length > 2) {
                    pushToUndoStack();
                    annotations.push(currentAnnotation);
                    setSelectedAnnotation(currentAnnotation);
                    updateTagHighlights();
                }
                setCurrentAnnotation(null);
            } else {
                currentAnnotation.points.push(clampToImageBounds(imgPos));
            }
        }
        drawImage();
    }

    else if (mode === 'select' && e.button === 0) {
        const clickedAnnotation = findSelectedAnnotation(pos);
        if (clickedAnnotation) {
            if (e.shiftKey) {
                addSelectedAnnotation(clickedAnnotation);
            } else if (e.altKey) {
                removeSelectedAnnotation(clickedAnnotation);
            } else if (e.ctrlKey) {
                toggleSelectedAnnotation(clickedAnnotation);
            } else {
                if (!isAnnotationSelected(clickedAnnotation) || selectedAnnotations.length <= 1) {
                    setSelectedAnnotation(clickedAnnotation);
                }
            }
            updateTagHighlights();
            setIsDragging(true);
            setStartX(pos.x);
            setStartY(pos.y);
            beginAnnotationDrag(clickedAnnotation);
            if ((clickedAnnotation.type === 'rect' || clickedAnnotation.type === 'obbox') && selectedPointIndex >= 0 && selectedAnnotations.length === 1) {
                const theta = (clickedAnnotation.rotation || 0) * Math.PI / 180;
                const cosTheta = Math.cos(theta);
                const sinTheta = Math.sin(theta);
                const centerX = clickedAnnotation.x + clickedAnnotation.width / 2;
                const centerY = clickedAnnotation.y + clickedAnnotation.height / 2;
                const localCorners = [
                    { x: -clickedAnnotation.width / 2, y: -clickedAnnotation.height / 2 },
                    { x: clickedAnnotation.width / 2, y: -clickedAnnotation.height / 2 },
                    { x: clickedAnnotation.width / 2, y: clickedAnnotation.height / 2 },
                    { x: -clickedAnnotation.width / 2, y: clickedAnnotation.height / 2 }
                ];
                const imageCorners = localCorners.map(local => {
                    const dx = local.x * cosTheta - local.y * sinTheta;
                    const dy = local.x * sinTheta + local.y * cosTheta;
                    return { x: centerX + dx, y: centerY + dy };
                });
                setInitialCorners(imageCorners);
                setInitialRotation(clickedAnnotation.rotation || 0);
            }
        } else {
            // Clicked on empty space: start marquee selection!
            let op = 'replace';
            if (e.shiftKey) op = 'add';
            else if (e.altKey) op = 'subtract';
            else if (e.ctrlKey) op = 'toggle';

            setIsSelectingMarquee(true);
            setMarqueeRect({
                startX: pos.x,
                startY: pos.y,
                currentX: pos.x,
                currentY: pos.y,
                op: op,
                initialOp: op
            });
            setStartX(pos.x);
            setStartY(pos.y);
        }
        drawImage();
    }
}

function handleMouseMove(e) {
    if ((isDragging || isRotating) && !dragUndoRecorded && selectedAnnotations.length > 0) {
        pushToUndoStack();
        dragUndoRecorded = true;
    }
    processMouseMove(e);
}

function processMouseMove(e) {
    const pos = getMousePos(canvas, e);
    const imgPos = toImageCoords(pos.x, pos.y);

    if (isSelectingMarquee && marqueeRect) {
        marqueeRect.currentX = pos.x;
        marqueeRect.currentY = pos.y;
        if (e.shiftKey) marqueeRect.op = 'add';
        else if (e.altKey) marqueeRect.op = 'subtract';
        else if (e.ctrlKey) marqueeRect.op = 'toggle';
        else marqueeRect.op = marqueeRect.initialOp || 'replace';
        drawImage();
        return;
    }

    // Update hovered annotation for tooltip
    const hovered = findHoveredAnnotation(pos);
    setHoveredAnnotation(hovered);
    drawImage();

    if (isPanning || (e.shiftKey && isDragging)) {
        viewport.x = pos.x - startX;
        viewport.y = pos.y - startY;
        canvas.style.cursor = 'grabbing';
        drawImage();
        return;
    }
    else if (mode === 'pan') {
        canvas.style.cursor = 'grab';
        return;
    }
    else if (isRotating && selectedAnnotation && (selectedAnnotation.type === 'rect' || selectedAnnotation.type === 'obbox')) {
        const center = {
            x: selectedAnnotation.x + selectedAnnotation.width / 2,
            y: selectedAnnotation.y + selectedAnnotation.height / 2
        };
        const angle = Math.atan2(imgPos.y - center.y, imgPos.x - center.x) * 180 / Math.PI + 90;
        selectedAnnotation.rotation = angle;
        drawImage();
        return;
    }
    else if (mode === 'rect' && (isDrawing || pendingDrawStart)) {
        if (!isDrawing && pendingDrawStart) {
            const dragDist = Math.hypot(pos.x - pendingDrawStart.startX, pos.y - pendingDrawStart.startY);
            if (dragDist > 4) {
                setIsDrawing(true);
                setCurrentAnnotation({
                    type: setupType === "Oriented Bounding Box" ? 'obbox' : 'rect',
                    origX: pendingDrawStart.origX,
                    origY: pendingDrawStart.origY,
                    x: pendingDrawStart.origX,
                    y: pendingDrawStart.origY,
                    width: 0,
                    height: 0,
                    rotation: 0,
                    label: selectedClass
                });
            }
        }

        if (isDrawing && currentAnnotation) {
            const clampedPos = clampToImageBounds(imgPos);
            const newX = Math.min(currentAnnotation.origX, clampedPos.x);
            const newY = Math.min(currentAnnotation.origY, clampedPos.y);
            const newWidth = Math.abs(clampedPos.x - currentAnnotation.origX);
            const newHeight = Math.abs(clampedPos.y - currentAnnotation.origY);
            currentAnnotation.x = newX;
            currentAnnotation.y = newY;
            currentAnnotation.width = newWidth;
            currentAnnotation.height = newHeight;
            drawImage();
        }
    }
    else if (isDragging && selectedAnnotations && selectedAnnotations.length > 0) {
        const dx = (pos.x - startX) / viewport.zoom;
        const dy = (pos.y - startY) / viewport.zoom;

        if (selectedAnnotations.length > 1 && selectedPointIndex < 0) {
            // Group translation with boundary clamping for the whole group
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            selectedAnnotations.forEach(ann => {
                if (ann.type === 'rect' || ann.type === 'obbox') {
                    const corners = ann.rotation ? getRotatedCorners(ann) : [
                        { x: ann.x, y: ann.y },
                        { x: ann.x + ann.width, y: ann.y + ann.height }
                    ];
                    corners.forEach(c => {
                        minX = Math.min(minX, c.x);
                        maxX = Math.max(maxX, c.x);
                        minY = Math.min(minY, c.y);
                        maxY = Math.max(maxY, c.y);
                    });
                } else if (ann.type === 'polygon' && Array.isArray(ann.points)) {
                    ann.points.forEach(p => {
                        minX = Math.min(minX, p.x);
                        maxX = Math.max(maxX, p.x);
                        minY = Math.min(minY, p.y);
                        maxY = Math.max(maxY, p.y);
                    });
                }
            });

            if (minX !== Infinity && currentImage) {
                const groupBBoxWidth = maxX - minX;
                const groupBBoxHeight = maxY - minY;
                const newMinX = minX + dx;
                const newMinY = minY + dy;
                const clampedMinX = Math.max(0, Math.min(newMinX, currentImage.width - groupBBoxWidth));
                const clampedMinY = Math.max(0, Math.min(newMinY, currentImage.height - groupBBoxHeight));
                const actualDx = clampedMinX - minX;
                const actualDy = clampedMinY - minY;

                selectedAnnotations.forEach(ann => {
                    if (ann.type === 'rect' || ann.type === 'obbox') {
                        ann.x += actualDx;
                        ann.y += actualDy;
                    } else if (ann.type === 'polygon' && Array.isArray(ann.points)) {
                        ann.points = ann.points.map(p => ({ x: p.x + actualDx, y: p.y + actualDy }));
                    }
                });
            }
            setStartX(pos.x);
            setStartY(pos.y);
            drawImage();
            return;
        }

        if (isRightClickEditing || mode === 'select' || mode === 'rect' || mode === 'polygon') {
            if (selectedAnnotation.type === 'rect' || selectedAnnotation.type === 'obbox') {
                if (selectedPointIndex >= 0) {
                    const clampedPos = clampToImageBounds(imgPos);

                    if (setupType === "Oriented Bounding Box") {
                        const centerX = selectedAnnotation.x + selectedAnnotation.width / 2;
                        const centerY = selectedAnnotation.y + selectedAnnotation.height / 2;
                        const rad = (selectedAnnotation.rotation || 0) * Math.PI / 180;
                        const cos = Math.cos(rad);
                        const sin = Math.sin(rad);
                    
                        const dxMouse = clampedPos.x - centerX;
                        const dyMouse = clampedPos.y - centerY;
                        const localX = dxMouse * cos + dyMouse * sin;
                        const localY = -dxMouse * sin + dyMouse * cos;
                    
                        const halfW = selectedAnnotation.width / 2;
                        const halfH = selectedAnnotation.height / 2;
                        const corners = [
                            { x: -halfW, y: -halfH },
                            { x: halfW, y: -halfH },
                            { x: halfW, y: halfH },
                            { x: -halfW, y: halfH }
                        ];
                    
                        let newWidth = selectedAnnotation.width;
                        let newHeight = selectedAnnotation.height;
                        let oppositePoint;
                    
                        if (selectedPointIndex < 4) {
                            let effectiveIndex;
                            if (selectedPointIndex === 2) {
                                effectiveIndex = 3;
                            } else if (selectedPointIndex === 3) {
                                effectiveIndex = 2;
                            } else {
                                effectiveIndex = selectedPointIndex;
                            }
                    
                            const oppositeIndex = (effectiveIndex + 2) % 4;
                            oppositePoint = corners[oppositeIndex];
                    
                            switch (effectiveIndex) {
                                case 0:
                                    newWidth = oppositePoint.x - localX;
                                    newHeight = oppositePoint.y - localY;
                                    break;
                                case 1:
                                    newWidth = localX - oppositePoint.x;
                                    newHeight = oppositePoint.y - localY;
                                    break;
                                case 2:
                                    newWidth = localX - oppositePoint.x;
                                    newHeight = localY - oppositePoint.y;
                                    break;
                                case 3:
                                    newWidth = oppositePoint.x - localX;
                                    newHeight = localY - oppositePoint.y;
                                    break;
                            }
                            
                            newWidth = Math.max(1, newWidth);
                            newHeight = Math.max(1, newHeight);
                            selectedAnnotation.width = newWidth;
                            selectedAnnotation.height = newHeight;
                            
                            const newHalfW = newWidth / 2;
                            const newHalfH = newHeight / 2;
                            const newCorners = [
                                { x: -newHalfW, y: -newHalfH },
                                { x: newHalfW, y: -newHalfH },
                                { x: newHalfW, y: newHalfH },
                                { x: -newHalfW, y: newHalfH }
                            ];
                            const newOppositeCornerLocal = newCorners[oppositeIndex];
                            const oppositeGlobalX = oppositePoint.x * cos - oppositePoint.y * sin + centerX;
                            const oppositeGlobalY = oppositePoint.x * sin + oppositePoint.y * cos + centerY;
                            const newCenterX = oppositeGlobalX - (newOppositeCornerLocal.x * cos - newOppositeCornerLocal.y * sin);
                            const newCenterY = oppositeGlobalY - (newOppositeCornerLocal.x * sin + newOppositeCornerLocal.y * cos);
                    
                            selectedAnnotation.x = newCenterX - newWidth / 2;
                            selectedAnnotation.y = newCenterY - newHeight / 2;
                        } else {
                            switch (selectedPointIndex) {
                                case 4:
                                    oppositePoint = { x: 0, y: halfH };
                                    newHeight = oppositePoint.y - localY;
                                    break;
                                case 5:
                                    oppositePoint = { x: 0, y: -halfH };
                                    newHeight = localY - oppositePoint.y;
                                    break;
                                case 6:
                                    oppositePoint = { x: halfW, y: 0 };
                                    newWidth = oppositePoint.x - localX;
                                    break;
                                case 7:
                                    oppositePoint = { x: -halfW, y: 0 };
                                    newWidth = localX - oppositePoint.x;
                                    break;
                            }
                    
                            if (selectedPointIndex === 4 || selectedPointIndex === 5) {
                                newHeight = Math.max(1, newHeight);
                                selectedAnnotation.height = newHeight;
                            } else {
                                newWidth = Math.max(1, newWidth);
                                selectedAnnotation.width = newWidth;
                            }
                    
                            const newHalfW = selectedAnnotation.width / 2;
                            const newHalfH = selectedAnnotation.height / 2;
                            const newEdges = [
                                { x: 0, y: -newHalfH },
                                { x: 0, y: newHalfH },
                                { x: -newHalfW, y: 0 },
                                { x: newHalfW, y: 0 }
                            ];
                            
                            const oppositeEdgeIndex = selectedPointIndex - 4;
                            const newOppositeEdgeLocal = newEdges[oppositeEdgeIndex ^ 1];
                            
                            const oppositeGlobalX = oppositePoint.x * cos - oppositePoint.y * sin + centerX;
                            const oppositeGlobalY = oppositePoint.x * sin + oppositePoint.y * cos + centerY;
                            const newCenterX = oppositeGlobalX - (newOppositeEdgeLocal.x * cos - newOppositeEdgeLocal.y * sin);
                            const newCenterY = oppositeGlobalY - (newOppositeEdgeLocal.x * sin + newOppositeEdgeLocal.y * cos);
                    
                            selectedAnnotation.x = newCenterX - newWidth / 2;
                            selectedAnnotation.y = newCenterY - newHeight / 2;
                        }
                    
                        clampAnnotationToBounds(selectedAnnotation);
                    } else {
                        const baseBox = initialBox || {
                            x: selectedAnnotation.x,
                            y: selectedAnnotation.y,
                            width: selectedAnnotation.width,
                            height: selectedAnnotation.height
                        };
                        const x1 = baseBox.x;
                        const y1 = baseBox.y;
                        const x2 = baseBox.x + baseBox.width;
                        const y2 = baseBox.y + baseBox.height;

                        switch (selectedPointIndex) {
                            case 0: { // Top-Left corner: anchor is bottom-right (x2, y2)
                                const curX = Math.min(clampedPos.x, x2 - 1);
                                const curY = Math.min(clampedPos.y, y2 - 1);
                                selectedAnnotation.x = curX;
                                selectedAnnotation.y = curY;
                                selectedAnnotation.width = x2 - curX;
                                selectedAnnotation.height = y2 - curY;
                                break;
                            }
                            case 1: { // Top-Right corner: anchor is bottom-left (x1, y2)
                                const curX = Math.max(clampedPos.x, x1 + 1);
                                const curY = Math.min(clampedPos.y, y2 - 1);
                                selectedAnnotation.x = x1;
                                selectedAnnotation.y = curY;
                                selectedAnnotation.width = curX - x1;
                                selectedAnnotation.height = y2 - curY;
                                break;
                            }
                            case 2: { // Bottom-Left corner: anchor is top-right (x2, y1)
                                const curX = Math.min(clampedPos.x, x2 - 1);
                                const curY = Math.max(clampedPos.y, y1 + 1);
                                selectedAnnotation.x = curX;
                                selectedAnnotation.y = y1;
                                selectedAnnotation.width = x2 - curX;
                                selectedAnnotation.height = curY - y1;
                                break;
                            }
                            case 3: { // Bottom-Right corner: anchor is top-left (x1, y1)
                                const curX = Math.max(clampedPos.x, x1 + 1);
                                const curY = Math.max(clampedPos.y, y1 + 1);
                                selectedAnnotation.x = x1;
                                selectedAnnotation.y = y1;
                                selectedAnnotation.width = curX - x1;
                                selectedAnnotation.height = curY - y1;
                                break;
                            }
                            case 4: { // Top edge handle: anchor is bottom edge (y2)
                                const curY = Math.min(clampedPos.y, y2 - 1);
                                selectedAnnotation.x = x1;
                                selectedAnnotation.y = curY;
                                selectedAnnotation.width = baseBox.width;
                                selectedAnnotation.height = y2 - curY;
                                break;
                            }
                            case 5: { // Bottom edge handle: anchor is top edge (y1)
                                const curY = Math.max(clampedPos.y, y1 + 1);
                                selectedAnnotation.x = x1;
                                selectedAnnotation.y = y1;
                                selectedAnnotation.width = baseBox.width;
                                selectedAnnotation.height = curY - y1;
                                break;
                            }
                            case 6: { // Left edge handle: anchor is right edge (x2)
                                const curX = Math.min(clampedPos.x, x2 - 1);
                                selectedAnnotation.x = curX;
                                selectedAnnotation.y = y1;
                                selectedAnnotation.width = x2 - curX;
                                selectedAnnotation.height = baseBox.height;
                                break;
                            }
                            case 7: { // Right edge handle: anchor is left edge (x1)
                                const curX = Math.max(clampedPos.x, x1 + 1);
                                selectedAnnotation.x = x1;
                                selectedAnnotation.y = y1;
                                selectedAnnotation.width = curX - x1;
                                selectedAnnotation.height = baseBox.height;
                                break;
                            }
                        }

                        clampAnnotationToBounds(selectedAnnotation);
                    }
                } else {
                    selectedAnnotation.x += dx;
                    selectedAnnotation.y += dy;
                    clampAnnotationToBounds(selectedAnnotation);
                }
            } else if (selectedAnnotation.type === 'polygon') {
                if (selectedPointIndex >= 0) {
                    selectedAnnotation.points[selectedPointIndex] = clampToImageBounds(imgPos);
                } else {
                    const xs = selectedAnnotation.points.map(p => p.x);
                    const ys = selectedAnnotation.points.map(p => p.y);
                    const minX = Math.min(...xs);
                    const maxX = Math.max(...xs);
                    const minY = Math.min(...ys);
                    const maxY = Math.max(...ys);
                    const bboxWidth = maxX - minX;
                    const bboxHeight = maxY - minY;
            
                    const newMinX = minX + dx;
                    const newMinY = minY + dy;
                    const clampedMinX = Math.max(0, Math.min(newMinX, currentImage.width - bboxWidth));
                    const clampedMinY = Math.max(0, Math.min(newMinY, currentImage.height - bboxHeight));
                    const adjustedDx = clampedMinX - minX;
                    const adjustedDy = clampedMinY - minY;
            
                    selectedAnnotation.points = selectedAnnotation.points.map(p => ({
                        x: p.x + adjustedDx,
                        y: p.y + adjustedDy
                    }));
                }
            }
            setStartX(pos.x);
            setStartY(pos.y);
        }
    } else {
        let cursorSet = false;
        if (selectedAnnotation && (selectedAnnotation.type === 'rect' || selectedAnnotation.type === 'obbox')) {
            const centerX = selectedAnnotation.x + selectedAnnotation.width / 2;
            const centerY = selectedAnnotation.y + selectedAnnotation.height / 2;
            const canvasCenter = toCanvasCoords(centerX, centerY);
            const halfWidth = selectedAnnotation.width * viewport.zoom / 2;
            const halfHeight = selectedAnnotation.height * viewport.zoom / 2;
            const rad = selectedAnnotation.rotation ? selectedAnnotation.rotation * Math.PI / 180 : 0;
            const corners = [
                { x: -halfWidth, y: -halfHeight },
                { x: halfWidth, y: -halfHeight },
                { x: -halfWidth, y: halfHeight },
                { x: halfWidth, y: halfHeight }
            ].map(corner => {
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                const x = canvasCenter.x + (corner.x * cos - corner.y * sin);
                const y = canvasCenter.y + (corner.x * sin + corner.y * cos);
                return { x, y };
            });
            const edges = [
                { x: 0, y: -halfHeight },
                { x: 0, y: halfHeight },
                { x: -halfWidth, y: 0 },
                { x: halfWidth, y: 0 }
            ].map(edge => {
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                const x = canvasCenter.x + (edge.x * cos - edge.y * sin);
                const y = canvasCenter.y + (edge.x * sin + edge.y * cos);
                return { x, y };
            });

            if (setupType === "Oriented Bounding Box") {
                const rotationHandle = { x: 0, y: -halfHeight - 20/viewport.zoom };
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                const rotX = canvasCenter.x + (rotationHandle.x * cos - rotationHandle.y * sin);
                const rotY = canvasCenter.y + (rotationHandle.x * sin + rotationHandle.y * cos);
                const distance = Math.sqrt(Math.pow(pos.x - rotX, 2) + Math.pow(pos.y - rotY, 2));
                if (distance < 12) {
                    canvas.style.cursor = 'grab';
                    cursorSet = true;
                }
            }
            if (!cursorSet) {
                for (let j = 0; j < corners.length; j++) {
                    const distance = Math.sqrt(Math.pow(pos.x - corners[j].x, 2) + Math.pow(pos.y - corners[j].y, 2));
                    if (distance < 12) {
                        canvas.style.cursor = (j === 0 || j === 3) ? 'nwse-resize' : 'nesw-resize';
                        cursorSet = true;
                        break;
                    }
                }
            }
            if (!cursorSet) {
                for (let j = 0; j < edges.length; j++) {
                    const distance = Math.sqrt(Math.pow(pos.x - edges[j].x, 2) + Math.pow(pos.y - edges[j].y, 2));
                    if (distance < 12) {
                        canvas.style.cursor = (j === 0 || j === 1) ? 'ns-resize' : 'ew-resize';
                        cursorSet = true;
                        break;
                    }
                }
            }
        } else if (selectedAnnotation && selectedAnnotation.type === 'polygon') {
            for (let j = 0; j < selectedAnnotation.points.length; j++) {
                const p = toCanvasCoords(selectedAnnotation.points[j].x, selectedAnnotation.points[j].y);
                const distance = Math.sqrt(Math.pow(pos.x - p.x, 2) + Math.pow(pos.y - p.y, 2));
                if (distance < 12) {
                    canvas.style.cursor = 'move';
                    cursorSet = true;
                    break;
                }
            }
        }

        if (!cursorSet) {
            if (hovered) {
                canvas.style.cursor = 'pointer';
            } else if (mode === 'rect' || mode === 'polygon' || mode === 'magic') {
                canvas.style.cursor = 'crosshair';
            } else {
                canvas.style.cursor = 'default';
            }
        }
    }
}

function handleMouseUp(e) {
    if (isPanning) {
        setIsPanning(false);
    }

    if (isSelectingMarquee && marqueeRect) {
        const dist = Math.hypot(marqueeRect.currentX - marqueeRect.startX, marqueeRect.currentY - marqueeRect.startY);
        if (dist > 4) {
            const minCanvasX = Math.min(marqueeRect.startX, marqueeRect.currentX);
            const minCanvasY = Math.min(marqueeRect.startY, marqueeRect.currentY);
            const maxCanvasX = Math.max(marqueeRect.startX, marqueeRect.currentX);
            const maxCanvasY = Math.max(marqueeRect.startY, marqueeRect.currentY);

            const p1 = toImageCoords(minCanvasX, minCanvasY);
            const p2 = toImageCoords(maxCanvasX, maxCanvasY);
            const imgBox = {
                x: Math.min(p1.x, p2.x),
                y: Math.min(p1.y, p2.y),
                width: Math.abs(p2.x - p1.x),
                height: Math.abs(p2.y - p1.y)
            };

            const hitAnnotations = annotations.filter(anno => {
                if (!isAnnotationVisible(anno)) return false;
                return isAnnotationIntersectingBox(anno, imgBox);
            });

            if (marqueeRect.op === 'add') {
                const merged = new Set([...selectedAnnotations, ...hitAnnotations]);
                setSelectedAnnotations(Array.from(merged));
            } else if (marqueeRect.op === 'subtract') {
                setSelectedAnnotations(selectedAnnotations.filter(a => !hitAnnotations.includes(a)));
            } else if (marqueeRect.op === 'toggle') {
                const current = [...selectedAnnotations];
                hitAnnotations.forEach(a => {
                    const idx = current.indexOf(a);
                    if (idx !== -1) current.splice(idx, 1);
                    else current.push(a);
                });
                setSelectedAnnotations(current);
            } else {
                setSelectedAnnotations(hitAnnotations);
            }
        } else {
            // Click without drag on empty space:
            if (marqueeRect.op === 'replace') {
                clearSelectedAnnotations();
            }
        }
        setIsSelectingMarquee(false);
        setMarqueeRect(null);
        updateTagHighlights();
        drawImage();
    }
    if (mode === 'rect') {
        if (isDrawing && currentAnnotation) {
            if (Math.abs(currentAnnotation.width) > 5 && Math.abs(currentAnnotation.height) > 5) {
                pushToUndoStack();
                annotations.push(currentAnnotation);
                setSelectedAnnotation(currentAnnotation);
                updateTagHighlights();
            } else {
                setSelectedAnnotation(null);
                setSelectedPointIndex(-1);
                updateTagHighlights();
            }
            setCurrentAnnotation(null);
            setIsDrawing(false);
            drawImage();
        } else if (pendingDrawStart) {
            // Mouse was clicked on empty space and released without dragging: clean click deselect
            setSelectedAnnotation(null);
            setSelectedPointIndex(-1);
            updateTagHighlights();
            drawImage();
        }
    }
    pendingDrawStart = null;
    dragUndoRecorded = false;
    setIsDragging(false);
    setIsRightClickEditing(false);
    setIsRotating(false);
    setIsPanning(false);
    setInitialBox(null);
}

function handleWheel(e) {
    e.preventDefault();
    const pos = getMousePos(canvas, e);
    const imgPos = toImageCoords(pos.x, pos.y);
    let zoomFactor = e.altKey ? (e.deltaY > 0 ? 0.99 : 1.01) : (e.deltaY > 0 ? 0.9 : 1.1);
    const newZoom = Math.max(viewport.minZoom, Math.min(viewport.maxZoom, viewport.zoom * zoomFactor));
    viewport.x = pos.x - imgPos.x * newZoom;
    viewport.y = pos.y - imgPos.y * newZoom;
    viewport.zoom = newZoom;
    drawImage();
}

export function initAnnotationInteraction() {
    if (!canvas) {
        console.error('Canvas not initialized. Call initGlobals() first.');
        return;
    }
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    // Finish editing even when the button is released outside the canvas.
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('auxclick', (e) => {
        if (e.button === 1) e.preventDefault();
    });
}
