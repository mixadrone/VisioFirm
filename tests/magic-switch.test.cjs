const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture(fetch) {
    const stored = new Map([['visiofirm_magic_model', 'sam2.1_t']]);
    const document = { activeElement: null, listeners: {} };
    const trigger = {
        disabled: false, listeners: {}, attributes: {},
        addEventListener(type, fn) { this.listeners[type] = fn; },
        setAttribute(name, value) { this.attributes[name] = value; },
        focus() { document.activeElement = this; },
    };
    const options = ['slimsam', 'sam2.1_t', 'sam2.1_s'].map(model => ({
        dataset: { model }, listeners: {}, attributes: {},
        addEventListener(type, fn) { this.listeners[type] = fn; },
        setAttribute(name, value) { this.attributes[name] = value; },
        focus() { document.activeElement = this; },
    }));
    const menu = {
        hidden: true, listeners: {},
        querySelectorAll: () => options,
        addEventListener(type, fn) { this.listeners[type] = fn; },
    };
    const picker = { contains: target => [trigger, menu, ...options].includes(target) };
    const status = { textContent: '', hidden: true };
    const elements = {
        'magic-model-picker': picker,
        'magic-model-trigger': trigger,
        'magic-model-menu': menu,
        'magic-model-status': status,
        'app-config': { textContent: JSON.stringify({ projectName: 'demo' }) },
    };
    document.getElementById = id => elements[id] || null;
    document.addEventListener = (type, fn) => { document.listeners[type] = fn; };
    const context = vm.createContext({
        console,
        localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) },
        document,
        fetch,
        drawImage() {},
        pushToUndoStack() { vm.runInContext('setIsModified(true)', context); },
    });
    const load = file => {
        const source = fs.readFileSync(path.join(__dirname, '../visiofirm/static/js', file), 'utf8')
            .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\r?\n/gm, '')
            .replace(/\bimport\.meta\.url\b/g, "''")
            .replace(/export /g, '');
        vm.runInContext(source, context);
    };
    load('globals.js');
    vm.runInContext(`
        currentImage = { width: 32, height: 32, src: '/projects/demo/images/one.png' };
        currentImageKey = '/projects/demo/images/one.png';
        currentImageIndex = 0;
        thumbnailImages = [{ closest: () => ({ dataset: { imageId: '7' } }) }];
        selectedClass = 'object';
        setupType = 'Bounding Box';
        updateTagHighlights = () => {};
    `, context);
    load('sam.js');
    context.initializeSegmentor();
    return { context, trigger, menu, options, status, stored, run: code => vm.runInContext(code, context) };
}

test('SAM 2.1 selection sends the current image ID and adds one editable annotation', async () => {
    let request;
    const f = fixture(async (url, options) => {
        request = { url, body: JSON.parse(options.body) };
        return { ok: true, json: async () => ({ annotation: { type: 'rect', x: 2, y: 3, width: 4, height: 5 } }) };
    });
    assert.equal(f.options[1].attributes['aria-checked'], 'true');
    await f.context.segmentArea({ x: 10, y: 11 });
    assert.equal(request.url, '/annotation/magic_segment');
    assert.equal(request.body.image_id, 7);
    assert.equal(request.body.model, 'sam2.1_t');
    assert.equal(f.run('annotations.length'), 1);
    assert.equal(f.run('annotations[0].label'), 'object');
    assert.equal(f.run('isModified'), true);
    assert.equal(f.status.hidden, true);
});

test('Models button opens the menu and saves the chosen model', () => {
    const f = fixture(async () => ({ ok: true, json: async () => ({ annotation: null }) }));
    f.trigger.listeners.click();
    assert.equal(f.menu.hidden, false);
    assert.equal(f.trigger.attributes['aria-expanded'], 'true');
    f.options[2].listeners.click();
    assert.equal(f.stored.get('visiofirm_magic_model'), 'sam2.1_s');
    assert.equal(f.options[2].attributes['aria-checked'], 'true');
    assert.equal(f.menu.hidden, true);
});

test('Models menu closes with Escape or an outside click', () => {
    const f = fixture(async () => ({ ok: true, json: async () => ({ annotation: null }) }));
    f.trigger.listeners.click();
    f.menu.listeners.keydown({ key: 'Escape', preventDefault() {} });
    assert.equal(f.menu.hidden, true);
    assert.equal(f.trigger.attributes['aria-expanded'], 'false');
    f.trigger.listeners.click();
    f.context.document.listeners.pointerdown({ target: {} });
    assert.equal(f.menu.hidden, true);
});

test('a result arriving after an image switch is discarded', async () => {
    let deliver;
    const f = fixture(() => new Promise(resolve => { deliver = resolve; }));
    const pending = f.context.segmentArea({ x: 10, y: 11 });
    f.run("currentImageKey = '/projects/demo/images/two.png'");
    deliver({ ok: true, json: async () => ({ annotation: { type: 'rect', x: 1, y: 1, width: 4, height: 4 } }) });
    await pending;
    assert.equal(f.run('annotations.length'), 0);
    assert.equal(f.run('isModified'), false);
    assert.equal(f.status.hidden, true);
});
