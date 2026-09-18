const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture() {
    const buttons = {};
    for (const id of ['rect-mode', 'select-mode', 'pan-mode', 'magic-mode', 'undo-btn', 'clear-annotations-btn']) {
        buttons[id] = {
            id, active: false, style: {}, listeners: {},
            classList: { toggle(_name, active) { buttons[id].active = active; } },
            setAttribute() {}, addEventListener(type, fn) { this.listeners[type] = fn; },
        };
    }
    const canvas = { style: {}, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    const windowListeners = {};
    const context = vm.createContext({
        console, localStorage: { getItem: () => null },
        document: {
            getElementById: id => buttons[id] || null,
            querySelectorAll: () => Object.values(buttons).filter(button => button.id.endsWith('-mode')),
        },
        window: { addEventListener(type, listener) { windowListeners[type] = listener; } },
        drawImage() {}, resetView() {}, updateAnnotationSummary() {},
        toImageCoords: (x, y) => ({ x, y }), setHoveredAnnotation() {},
        testCanvas: canvas,
    });
    const load = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '../visiofirm/static/js', file), 'utf8')
        .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\r?\n/gm, '').replace(/export /g, ''), context);
    load('globals.js');
    vm.runInContext(`
        canvas = testCanvas;
        currentImageKey = '/image.jpg';
        setupType = 'Bounding Box';
        updateTagHighlights = () => {};
        function pushToUndoStack() { (undoStack[currentImageKey] ??= []).push(structuredCloneForTest(annotations)); }
        function structuredCloneForTest(value) { return JSON.parse(JSON.stringify(value)); }
    `, context);
    load('toolControls.js');
    load('annotationInteraction.js');
    context.initToolControls();
    context.initAnnotationInteraction();
    return {
        buttons, canvas, context, windowListeners,
        run: code => vm.runInContext(code, context),
        click: id => buttons[id].listeners.click(),
    };
}

test('clear removes manual and AI annotations and Undo restores both in one step', () => {
    const f = fixture();
    f.run(`annotations = [{type:'rect', label:'a'}, {type:'rect', label:'b', isPreannotation:true}]; selectedAnnotation = annotations[0];`);
    f.click('clear-annotations-btn');
    assert.equal(f.run('annotations.length'), 0);
    assert.equal(f.run('selectedAnnotation'), null);
    assert.equal(f.run('isModified'), true);
    f.click('clear-annotations-btn');
    assert.equal(f.run('undoStack[currentImageKey].length'), 1);
    f.click('undo-btn');
    assert.equal(f.run('annotations.length'), 2);
    assert.equal(f.run('annotations[1].isPreannotation'), true);
});

test('Pan toggles back to the previous tool and keyboard mode changes update highlight', () => {
    const f = fixture();
    f.click('magic-mode');
    f.click('pan-mode');
    assert.equal(f.run('mode'), 'pan');
    assert.equal(f.buttons['pan-mode'].active, true);
    assert.equal(f.canvas.style.cursor, 'grab');
    f.click('pan-mode');
    assert.equal(f.run('mode'), 'magic');
    f.run("setMode('rect')");
    assert.equal(f.buttons['rect-mode'].active, true);
    assert.equal(f.buttons['pan-mode'].active, false);
});

test('middle-button panning restores mode, cursor and highlight even after release outside canvas', () => {
    const f = fixture();
    f.context.handleMouseDown({ clientX: 50, clientY: 60, button: 1, preventDefault() {} });
    assert.equal(f.run('mode'), 'rect');
    assert.equal(f.run('isPanning'), true);
    assert.equal(f.buttons['pan-mode'].active, true);
    f.windowListeners.mouseup();
    assert.equal(f.run('isPanning'), false);
    assert.equal(f.canvas.style.cursor, 'crosshair');
    assert.equal(f.buttons['rect-mode'].active, true);
    assert.equal(f.run('isModified'), false);
});

test('Pan tool enables left-button panning and mouseup leaves Pan selected', () => {
    const f = fixture();
    f.click('pan-mode');
    f.context.handleMouseDown({ clientX: 50, clientY: 60, button: 0, preventDefault() {} });
    assert.equal(f.run('isPanning'), true);
    f.context.handleMouseUp({ button: 0 });
    assert.equal(f.run('isPanning'), false);
    assert.equal(f.run('mode'), 'pan');
    assert.equal(f.canvas.style.cursor, 'grab');
    assert.equal(f.run('isModified'), false);
});
