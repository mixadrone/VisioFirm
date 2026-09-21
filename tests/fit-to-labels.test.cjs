const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function source(name) {
    return fs.readFileSync(path.join(__dirname, '../visiofirm/static/js', name), 'utf8')
        .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\r?\n/gm, '')
        .replace(/export /g, '');
}

const rect = (x, y, width, height, extra = {}) => ({ type: 'rect', x, y, width, height, label: 'a', ...extra });

function fixture(annotations = []) {
    const context = vm.createContext({
        annotations, setupType: 'Bounding Box', confidenceThreshold: 0.4,
        isAnnotationLabelHidden: label => label === 'hidden',
        currentImage: { width: 2000, height: 1000 }, currentImageKey: '/images/a.jpg',
        viewport: { x: 0, y: 0, zoom: 1, fitZoom: 0.45, minZoom: 0.225, maxZoom: 20 },
        canvas: { width: 1000, height: 500, style: {} },
        ctx: new Proxy({}, { get: () => () => {}, set: () => true }),
        getResolvedAnnotationStyle: () => ({ strokeColor: '#fff', fillColor: '#fff', strokeWidth: 1, fillOpacity: 0 }),
        classColors: {}, gridEnabled: false, currentAnnotation: null, selectedAnnotation: null,
        isDrawing: false, isModified: false, requestAnimationFrame() {},
    });
    vm.runInContext(source('annotationCore.js'), context);
    vm.runInContext(source('annotationDrawing.js'), context);
    return context;
}

function assertVisible(context, points) {
    for (const point of points) {
        const { x, y } = context.toCanvasCoords(point.x, point.y);
        assert.ok(x >= -1e-8 && x <= context.canvas.width + 1e-8, `x=${x}`);
        assert.ok(y >= -1e-8 && y <= context.canvas.height + 1e-8, `y=${y}`);
    }
}

test('fits visible labels, excluding hidden classes and low-confidence predictions', () => {
    const c = fixture([
        rect(900, 450, 100, 50),
        rect(1000, 500, 100, 50, { isPreannotation: true, confidence: 0.4 }),
        rect(0, 0, 2000, 1000, { label: 'hidden' }),
        rect(0, 0, 2000, 1000, { isPreannotation: true, confidence: 0.39 }),
        rect(0, 0, 2000, 1000, { isPreannotation: true }),
    ]);
    const before = JSON.stringify(c.annotations);
    c.fitToLabels();
    assert.equal(c.viewport.zoom, 4.5);
    assertVisible(c, [{ x: 900, y: 450 }, { x: 1100, y: 550 }]);
    assert.equal(JSON.stringify(c.annotations), before);
    assert.equal(c.isModified, false);
    assert.equal(c.selectedAnnotation, null);
});

test('includes rotated corners and every polygon vertex across distant labels', () => {
    const box = rect(200, 200, 200, 100, { type: 'obbox', rotation: 45 });
    const polygon = { type: 'polygon', points: [{ x: 1700, y: 800 }, { x: 1800, y: 800 }, { x: 1750, y: 900 }] };
    const c = fixture([box, polygon]);
    c.fitToLabels();
    assertVisible(c, [...c.getRotatedCorners(box), ...polygon.points]);
    assert.ok(c.viewport.zoom > c.viewport.fitZoom);
});

test('tiny labels respect maximum zoom and edge labels stay visible after pan clamping', () => {
    for (const [x, y] of [[0, 0], [1999, 999], [1000, 500]]) {
        const c = fixture([rect(x, y, 1, 1)]);
        c.fitToLabels();
        assert.equal(c.viewport.zoom, 20);
        assertVisible(c, [{ x, y }, { x: x + 1, y: y + 1 }]);
    }
});

test('empty, filtered, invalid, and classification labels fall back to full image', () => {
    for (const annotations of [[], [rect(0, 0, 10, 10, { label: 'hidden' })],
        [rect(NaN, 0, 10, 10), rect(0, 0, 0, 10),
            { type: 'polygon', points: [{ x: 0, y: 0 }, null, { x: 10, y: 10 }] }]]) {
        const c = fixture(annotations);
        // Isolate fitting from the renderer's handling of malformed input.
        vm.runInContext('drawImage = () => {};', c);
        c.fitToLabels();
        assert.equal(c.viewport.zoom, 0.45);
        assert.equal(c.viewport.x, 50);
        assert.equal(c.viewport.y, 25);
    }
    const c = fixture([rect(900, 450, 100, 50)]);
    c.setupType = 'Classification';
    c.fitToLabels();
    assert.equal(c.viewport.zoom, 0.45);
});

test('redraw after manual zoom, edits, or filtering does not refit; reset shows full image', () => {
    const c = fixture([rect(900, 450, 100, 50)]);
    c.fitToLabels();
    c.viewport.zoom = 2;
    c.annotations.push(rect(0, 0, 500, 500));
    c.confidenceThreshold = 0.9;
    c.drawImage();
    assert.equal(c.viewport.zoom, 2);
    c.resetView();
    assert.equal(c.viewport.zoom, 0.45);
});

test('preference defaults off and persists across reloads', () => {
    const storage = new Map();
    const make = () => {
        const c = vm.createContext({ localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
        } });
        vm.runInContext(source('globals.js'), c);
        return c;
    };
    const c = make();
    assert.equal(vm.runInContext('isFitToLabelsEnabled', c), false);
    c.setIsFitToLabelsEnabled(true);
    assert.equal(storage.get('visiofirm_fit_to_labels'), 'true');
    assert.equal(vm.runInContext('isFitToLabelsEnabled', make()), true);
    c.setIsFitToLabelsEnabled(false);
    assert.equal(vm.runInContext('isFitToLabelsEnabled', make()), false);
});

test('canvas resizing applies the preference using current annotations', () => {
    const c = fixture([rect(900, 450, 100, 50)]);
    c.isFitToLabelsEnabled = true;
    c.document = {
        addEventListener() {},
        querySelector: () => ({ clientWidth: 1000, clientHeight: 500, querySelector: () => null }),
    };
    c.getComputedStyle = () => ({});
    vm.runInContext(source('imageHandling.js'), c);
    c.resizeCanvas();
    assert.equal(c.viewport.zoom, 9);
    c.annotations = [];
    c.resizeCanvas();
    assert.equal(c.viewport.zoom, 0.45);
    c.annotations = [rect(900, 450, 100, 50)];
    c.isFitToLabelsEnabled = false;
    c.resizeCanvas();
    assert.equal(c.viewport.zoom, 0.45);
});

test('image switching fits after asynchronous loading and cache restoration without saving', async () => {
    const c = fixture();
    Object.assign(c, {
        currentImageKey: null, annotationCache: {}, undoStack: {}, isFitToLabelsEnabled: true,
        isAutoSaveEnabled: true, console: { log() {}, warn() {}, error() {} }, URL,
        window: { location: { href: 'http://localhost/' } },
        getComputedStyle: () => ({}),
        updateTagHighlights() {}, updateAnnotationStatus() {}, updateClassTags() {},
        executeSave() { assert.fail('Fitting must not trigger auto-save'); },
        fetch: async () => ({ ok: true, json: async () => ({ success: true, annotations: [],
            preannotations: [rect(900, 450, 100, 50, { confidence: 0.9 })] }) }),
        Image: class {
            constructor() { this.width = 2000; this.height = 1000; }
            set src(value) { queueMicrotask(() => this.onload()); }
        },
        document: {
            addEventListener() {}, querySelectorAll: () => [],
            getElementById: id => id === 'app-config' ? { textContent: '{"projectName":"demo"}' } : null,
            querySelector: selector => selector === '.image-container'
                ? { clientWidth: 1000, clientHeight: 500, querySelector: () => null } : null,
        },
    });
    for (const name of ['CurrentImageKey', 'CurrentImageIndex', 'CurrentImage', 'Annotations',
        'SelectedAnnotation', 'SelectedLabel', 'AnnotationCache', 'UndoStack', 'IsModified']) {
        c[`set${name}`] = value => { c[name[0].toLowerCase() + name.slice(1)] = value; };
    }
    const thumbnail = file => ({ getAttribute: () => `/images/${file}.jpg`, closest: () => null });
    const first = thumbnail('a'), second = thumbnail('b');
    c.thumbnailImages = [first, second];
    vm.runInContext(source('imageHandling.js'), c);
    await c.selectImage(first);
    assert.equal(c.viewport.zoom, 9);
    assert.equal(c.annotations[0].isPreannotation, true);
    assert.equal(c.isModified, false);
    c.annotations = [rect(700, 400, 300, 100)];
    await c.selectImage(second);
    assert.equal(c.viewport.zoom, 9);
    await c.selectImage(first);
    assert.equal(c.viewport.zoom, 3);
    assert.equal(c.annotations[0].width, 300);
    assert.equal(c.selectedAnnotation, null);
    assert.equal(c.isModified, false);
});
