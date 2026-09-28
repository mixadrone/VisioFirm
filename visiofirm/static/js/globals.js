export let setupType = null;
export let annotationCache = {};
export let currentImageKey = null;
export let currentImageIndex = -1;
export let thumbnailImages = [];
export let canvas = null;
export let ctx = null;
export let viewport = { x: 0, y: 0, zoom: 1, minZoom: .1, maxZoom: 20, fitZoom: 1 };
export let currentImage = null;
export let mode = 'rect';
export let annotations = [];
export let currentAnnotation = null;
export let isDrawing = false;
export let isDragging = false;
export let startX = 0;
export let startY = 0;
export let selectedAnnotation = null;
export let selectedAnnotations = [];
export let isSelectingMarquee = false;
export let marqueeRect = null;
export let selectedPointIndex = -1;
export let undoStack = {};
export let isRightClickEditing = false;
export let clipboardImageResolution = { width: 0, height: 0 };
export let gridEnabled = false;
export const gridSize = 5;
export let classColors = {};
export let isRotating = false;
export let initialRotation = 0;
export let initialCorners = [];
export let initialBox = null;
export let isPanning = false;
export let preannotations = [];
export let confidenceThreshold = 0.4;
export let selectedClass = null;
export let imageEmbeddings = null;
export let imageProcessed = null;
export let worker = null;
export let selectedLabel = null;
export let hiddenAnnotationLabels = new Set();
export let isModified = false;
export let isAutoSaveEnabled = localStorage.getItem('visiofirm_autosave_on_switch') === 'true';
export let isFitToLabelsEnabled = localStorage.getItem('visiofirm_fit_to_labels') === 'true';
export function setIsFitToLabelsEnabled(value) {
    isFitToLabelsEnabled = Boolean(value);
    localStorage.setItem('visiofirm_fit_to_labels', String(isFitToLabelsEnabled));
}
export let isAdvanceAfterSaveEnabled = localStorage.getItem('visiofirm_advance_after_save') === 'true';
export function setIsAdvanceAfterSaveEnabled(value) {
    isAdvanceAfterSaveEnabled = Boolean(value);
    localStorage.setItem('visiofirm_advance_after_save', String(isAdvanceAfterSaveEnabled));
}

// Global gallery card display settings
export let isCardShowDots = localStorage.getItem('visiofirm_card_show_dots') !== 'false'; // default true
export function setIsCardShowDots(value) {
    isCardShowDots = Boolean(value);
    localStorage.setItem('visiofirm_card_show_dots', String(isCardShowDots));
}

export let isCardShowFilename = localStorage.getItem('visiofirm_card_show_filename') === 'true'; // default false
export function setIsCardShowFilename(value) {
    isCardShowFilename = Boolean(value);
    localStorage.setItem('visiofirm_card_show_filename', String(isCardShowFilename));
}

export let isCardShowDate = localStorage.getItem('visiofirm_card_show_date') === 'true'; // default false
export function setIsCardShowDate(value) {
    isCardShowDate = Boolean(value);
    localStorage.setItem('visiofirm_card_show_date', String(isCardShowDate));
}

export let isCardShowStatus = localStorage.getItem('visiofirm_card_show_status') === 'true'; // default false
export function setIsCardShowStatus(value) {
    isCardShowStatus = Boolean(value);
    localStorage.setItem('visiofirm_card_show_status', String(isCardShowStatus));
}

export function setIsModified(value) { isModified = Boolean(value); }
export function setIsAutoSaveEnabled(value) {
    isAutoSaveEnabled = Boolean(value);
    localStorage.setItem('visiofirm_autosave_on_switch', isAutoSaveEnabled ? 'true' : 'false');
}
export function setSelectedLabel(value) { selectedLabel = value; }
export function setIsMoving(value) { isMoving = value; }
export function setInitialRotation(value) { initialRotation = value; }
export function setInitialCorners(value) { initialCorners = value; }
export function setInitialBox(value) { initialBox = value; }
export function setIsPanning(value) { isPanning = Boolean(value); updateToolModeUI(); }
export function setIsDrawing(value) { isDrawing = value; }
export function setMode(value) { mode = value; updateToolModeUI(); }
export function updateToolModeUI() {
    const activeMode = isPanning ? 'pan' : mode;
    document.querySelectorAll('.control-btn[id$="-mode"]').forEach(button => {
        const active = button.id === `${activeMode}-mode`;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    if (canvas) canvas.style.cursor = isPanning ? 'grabbing' : mode === 'pan' ? 'grab'
        : ['rect', 'polygon', 'magic'].includes(mode) ? 'crosshair' : 'default';
}
export function setCurrentImageKey(value) { currentImageKey = value; }
export function setAnnotations(value) { annotations = value; }
export function setSelectedAnnotation(value) {
    selectedAnnotation = value;
    selectedAnnotations = value ? [value] : [];
}
export function setSelectedAnnotations(items) {
    selectedAnnotations = Array.isArray(items) ? [...items] : [];
    selectedAnnotation = selectedAnnotations.length > 0 ? selectedAnnotations[selectedAnnotations.length - 1] : null;
}
export function addSelectedAnnotation(item) {
    if (item && !selectedAnnotations.includes(item)) {
        selectedAnnotations.push(item);
        selectedAnnotation = item;
    }
}
export function removeSelectedAnnotation(item) {
    const idx = selectedAnnotations.indexOf(item);
    if (idx !== -1) {
        selectedAnnotations.splice(idx, 1);
        selectedAnnotation = selectedAnnotations.length > 0 ? selectedAnnotations[selectedAnnotations.length - 1] : null;
    }
}
export function toggleSelectedAnnotation(item) {
    if (!item) return;
    if (selectedAnnotations.includes(item)) {
        removeSelectedAnnotation(item);
    } else {
        addSelectedAnnotation(item);
    }
}
export function clearSelectedAnnotations() {
    selectedAnnotations = [];
    selectedAnnotation = null;
}
export function isAnnotationSelected(item) {
    return item ? selectedAnnotations.includes(item) : false;
}
export function setIsSelectingMarquee(value) {
    isSelectingMarquee = Boolean(value);
}
export function setMarqueeRect(value) {
    marqueeRect = value;
}
export function setCurrentImage(value) { currentImage = value; }
export function setCurrentImageIndex(value) { currentImageIndex = value; }
export function setGridEnabled(value) { gridEnabled = value; }
export function setCurrentAnnotation(value) { currentAnnotation = value; }
export function setIsDragging(value) { isDragging = value; }
export function setStartX(value) { startX = value; }
export function setStartY(value) { startY = value; }
export function setSelectedPointIndex(value) { selectedPointIndex = value; }
export function setIsRightClickEditing(value) { isRightClickEditing = value; }
export function setUndoStack(value) { undoStack = value; }
export function setIsRotating(value) { isRotating = value; }
export function setSetupType(value) { setupType = value; }
export function setThumbnailImages(value) { thumbnailImages = value; }
export function setCanvas(value) { canvas = value; }
export function setCtx(value) { ctx = value; }
export function setViewport(value) { viewport = value; }
export function setClipboardImageResolution(value) { clipboardImageResolution = value; }
export function setClassColors(value) { classColors = value; }
export function setSelectedClass(value) { selectedClass = value; }
export function setPreannotations(value) { preannotations = value; }
export function setConfidenceThreshold(value) { confidenceThreshold = value; }
export function setWorker(value) { worker = value; } // Added setter for worker
export function isAnnotationLabelHidden(label) { return hiddenAnnotationLabels.has(label); }
export function toggleHiddenAnnotationLabel(label) {
    if (hiddenAnnotationLabels.has(label)) {
        hiddenAnnotationLabels.delete(label);
        return false;
    }
    hiddenAnnotationLabels.add(label);
    return true;
}
export function clearHiddenAnnotationLabels() { hiddenAnnotationLabels = new Set(); }

export function initGlobals() {
    const config = JSON.parse(document.getElementById('app-config').textContent);
    setupType = config.setupType;
    classColors = {};
    console.log('Initializing class colors for:', config.classes);
    
    if (config.classes.length > 0) {
        setSelectedClass(config.classes[0]);
    }

    config.classes.forEach(cls => {
        classColors[cls] = getClassColor(cls);
    });
    thumbnailImages = document.querySelectorAll('#annotation-view .thumbnail-image img');
    canvas = document.getElementById('labeling-canvas');
    ctx = canvas.getContext('2d');
    mode = (setupType === "Segmentation") ? 'polygon' : 'rect';
    if (setupType === "Classification") {
        mode = 'select';
    }
    console.log('Canvas initialized:', canvas, ctx);
}

export function updateTagHighlights() {
    document.querySelectorAll('.class-tag').forEach(t => {
        t.classList.remove('highlighted');
        t.classList.remove('selected');
    });
    if (selectedAnnotations && selectedAnnotations.length > 0) {
        selectedAnnotations.forEach(ann => {
            if (ann && ann.label) {
                const tag = document.querySelector(`.class-tag[data-class="${ann.label}"]`);
                if (tag) tag.classList.add('highlighted');
            }
        });
    } else if (selectedClass) {
        const tag = document.querySelector(`.class-tag[data-class="${selectedClass}"]`);
        if (tag) tag.classList.add('selected');
    }
}

function getClassColor(className) {
    const hash = Array.from(className).reduce((hash, char) => char.charCodeAt(0) + ((hash << 5) - hash), 0);
    const r = (hash & 0xFF0000) >> 16;
    const g = (hash & 0x00FF00) >> 8;
    const b = hash & 0x0000FF;
    return `rgba(${r}, ${g}, ${b}, 0.95)`;
}

export function setAnnotationCache(newCache) {
    annotationCache = newCache;
    console.log('Annotation Cache Updated:', annotationCache);
}
