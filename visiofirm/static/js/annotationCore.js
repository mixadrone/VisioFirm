import { viewport, currentImage, currentImageKey, undoStack, annotations, gridEnabled, gridSize, setIsModified } from './globals.js';

export function toImageCoords(x, y) {
    return { x: (x - viewport.x) / viewport.zoom, y: (y - viewport.y) / viewport.zoom };
}

export function toCanvasCoords(x, y) {
    return { x: viewport.x + x * viewport.zoom, y: viewport.y + y * viewport.zoom };
}

export function clampToImageBounds(point) {
    if (!currentImage) return point;
    let snappedPoint = {
        x: Math.max(0, Math.min(point.x, currentImage.width)),
        y: Math.max(0, Math.min(point.y, currentImage.height))
    };
    if (gridEnabled) {
        snappedPoint.x = Math.round(snappedPoint.x / gridSize) * gridSize;
        snappedPoint.y = Math.round(snappedPoint.y / gridSize) * gridSize;
    }
    return snappedPoint;
}

// Calculate the rotated corners of a rectangle
export function getRotatedCorners(annotation) {
    const centerX = annotation.x + annotation.width / 2;
    const centerY = annotation.y + annotation.height / 2;
    const rad = (annotation.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    
    const corners = [
        { x: annotation.x, y: annotation.y },
        { x: annotation.x + annotation.width, y: annotation.y },
        { x: annotation.x + annotation.width, y: annotation.y + annotation.height },
        { x: annotation.x, y: annotation.y + annotation.height }
    ];
    
    return corners.map(corner => {
        const dx = corner.x - centerX;
        const dy = corner.y - centerY;
        return {
            x: centerX + (dx * cos - dy * sin),
            y: centerY + (dx * sin + dy * cos)
        };
    });
}

// Clamp annotation to image bounds considering rotation
// In annotationCore.js
export function clampAnnotationToBounds(annotation) {
    if (!currentImage) return;

    if (annotation.type === 'polygon') {
        // For polygons, clamp each point individually
        annotation.points = annotation.points.map(p => clampToImageBounds(p));
        return;
    }

    if (annotation.type !== 'rect' || !annotation.rotation) {
        // For non-rotated rectangles, use simple clamping
        annotation.x = Math.max(0, Math.min(annotation.x, currentImage.width - annotation.width));
        annotation.y = Math.max(0, Math.min(annotation.y, currentImage.height - annotation.height));
        return;
    }

    // For rotated rectangles, we need more sophisticated clamping
    const centerX = annotation.x + annotation.width / 2;
    const centerY = annotation.y + annotation.height / 2;
    const rad = (annotation.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Get current corners
    const corners = getRotatedCorners(annotation);
    
    // Calculate how much we're out of bounds
    let minX = Math.min(...corners.map(c => c.x));
    let maxX = Math.max(...corners.map(c => c.x));
    let minY = Math.min(...corners.map(c => c.y));
    let maxY = Math.max(...corners.map(c => c.y));

    // Calculate needed translation (without resizing)
    let tx = 0, ty = 0;
    if (minX < 0) tx = -minX;
    if (maxX > currentImage.width) tx = currentImage.width - maxX;
    if (minY < 0) ty = -minY;
    if (maxY > currentImage.height) ty = currentImage.height - maxY;

    // First try just translating
    annotation.x += tx;
    annotation.y += ty;

    // Check if we're still out of bounds after translation
    const newCorners = getRotatedCorners(annotation);
    minX = Math.min(...newCorners.map(c => c.x));
    maxX = Math.max(...newCorners.map(c => c.x));
    minY = Math.min(...newCorners.map(c => c.y));
    maxY = Math.max(...newCorners.map(c => c.y));

    const outOfBounds = minX < 0 || maxX > currentImage.width || 
                       minY < 0 || maxY > currentImage.height;

    if (outOfBounds) {
        // If still out of bounds, calculate maximum allowed size
        const currentDiag = Math.sqrt(annotation.width * annotation.width + annotation.height * annotation.height);
        
        // Calculate maximum possible diagonal that fits within image
        const maxDiag = Math.min(
            Math.min(currentImage.width, currentImage.height),
            currentDiag * 0.95 // Slightly smaller to ensure it fits
        );

        // Only scale down if necessary (don't scale up)
        if (maxDiag < currentDiag) {
            const scale = maxDiag / currentDiag;
            
            // Scale while maintaining aspect ratio
            const newWidth = annotation.width * scale;
            const newHeight = annotation.height * scale;
            
            // Update dimensions while keeping center fixed
            annotation.x = centerX - newWidth / 2;
            annotation.y = centerY - newHeight / 2;
            annotation.width = newWidth;
            annotation.height = newHeight;
        }

        // Final adjustment to ensure we're within bounds
        const finalCorners = getRotatedCorners(annotation);
        minX = Math.min(...finalCorners.map(c => c.x));
        maxX = Math.max(...finalCorners.map(c => c.x));
        minY = Math.min(...finalCorners.map(c => c.y));
        maxY = Math.max(...finalCorners.map(c => c.y));

        tx = 0, ty = 0;
        if (minX < 0) tx = -minX;
        if (maxX > currentImage.width) tx = currentImage.width - maxX;
        if (minY < 0) ty = -minY;
        if (maxY > currentImage.height) ty = currentImage.height - maxY;

        annotation.x += tx;
        annotation.y += ty;
    }
}

export function pushToUndoStack() {
    if (!currentImageKey) return;
    setIsModified(true);
    if (!undoStack[currentImageKey]) undoStack[currentImageKey] = [];
    const stack = undoStack[currentImageKey];
    if (stack.length >= 50) stack.shift();
    stack.push(JSON.parse(JSON.stringify(annotations)));
}

export function isPointInAnnotationImageCoords(imgPoint, annotation) {
    if (!annotation) return false;
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
    } else if (annotation.type === 'polygon' && Array.isArray(annotation.points)) {
        let inside = false;
        const pts = annotation.points;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].x, yi = pts[i].y;
            const xj = pts[j].x, yj = pts[j].y;
            const intersect = ((yi > imgPoint.y) !== (yj > imgPoint.y)) &&
                (imgPoint.x < (xj - xi) * (imgPoint.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }
    return false;
}

export function isAnnotationIntersectingBox(annotation, box) {
    if (!annotation || !box || box.width < 0 || box.height < 0) return false;
    const bx1 = box.x;
    const by1 = box.y;
    const bx2 = box.x + box.width;
    const by2 = box.y + box.height;

    const isPointInBox = (p) => p.x >= bx1 && p.x <= bx2 && p.y >= by1 && p.y <= by2;

    const segmentsIntersect = (p1, p2, p3, p4) => {
        const ccw = (A, B, C) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
        return (ccw(p1, p3, p4) !== ccw(p2, p3, p4)) && (ccw(p1, p2, p3) !== ccw(p1, p2, p4));
    };

    const boxSegments = [
        [{ x: bx1, y: by1 }, { x: bx2, y: by1 }],
        [{ x: bx2, y: by1 }, { x: bx2, y: by2 }],
        [{ x: bx2, y: by2 }, { x: bx1, y: by2 }],
        [{ x: bx1, y: by2 }, { x: bx1, y: by1 }]
    ];

    if (annotation.type === 'rect' && !annotation.rotation) {
        const ax1 = annotation.x;
        const ay1 = annotation.y;
        const ax2 = annotation.x + annotation.width;
        const ay2 = annotation.y + annotation.height;
        return !(bx2 < ax1 || bx1 > ax2 || by2 < ay1 || by1 > ay2);
    }

    let points = [];
    if (annotation.type === 'rect' || annotation.type === 'obbox') {
        points = getRotatedCorners(annotation);
    } else if (annotation.type === 'polygon' && Array.isArray(annotation.points)) {
        points = annotation.points;
    }

    if (points.length === 0) return false;

    // 1. Any point of annotation is inside box
    for (let i = 0; i < points.length; i++) {
        if (isPointInBox(points[i])) return true;
    }

    // 2. Any point of box is inside annotation
    const boxCorners = [
        { x: bx1, y: by1 },
        { x: bx2, y: by1 },
        { x: bx2, y: by2 },
        { x: bx1, y: by2 }
    ];
    for (let i = 0; i < boxCorners.length; i++) {
        if (isPointInAnnotationImageCoords(boxCorners[i], annotation)) return true;
    }

    // 3. Any segment of annotation intersects any edge of box
    for (let i = 0; i < points.length; i++) {
        const nextIdx = (i + 1) % points.length;
        const p1 = points[i];
        const p2 = points[nextIdx];
        for (let j = 0; j < boxSegments.length; j++) {
            if (segmentsIntersect(p1, p2, boxSegments[j][0], boxSegments[j][1])) {
                return true;
            }
        }
    }

    return false;
}

export function scaleAnnotation(annotation, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const scaleX = targetWidth / sourceWidth;
    const scaleY = targetHeight / sourceHeight;
    const scaled = JSON.parse(JSON.stringify(annotation));
    if (scaled.type === 'rect' || scaled.type === 'obbox') {
        scaled.x *= scaleX;
        scaled.y *= scaleY;
        scaled.width *= scaleX;
        scaled.height *= scaleY;
    } else if (scaled.type === 'polygon' && Array.isArray(scaled.points)) {
        scaled.points = scaled.points.map(p => ({
            x: p.x * scaleX,
            y: p.y * scaleY
        }));
    }
    return scaled;
}

export function polygonArea(points) {
    if (!Array.isArray(points) || points.length < 3) return 0;
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
    }
    return Math.abs(area / 2);
}