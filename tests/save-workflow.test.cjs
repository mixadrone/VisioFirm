const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ advance = true, success = true, delayed = false } = {}) {
    let resolve;
    let requests = 0;
    let moves = 0;
    const statuses = [];
    const response = { ok: success, status: success ? 200 : 500, json: async () => ({ success }) };
    const wait = delayed ? new Promise(done => { resolve = done; }) : Promise.resolve(response);
    const button = { disabled: false };
    const context = vm.createContext({
        currentImageKey: '/images/1.jpg', annotations: [{ type: 'rect', label: 'a', x: 0, y: 0, width: 20, height: 10, isPreannotation: true, confidence: 0.9 }],
        annotationCache: {}, confidenceThreshold: 0.4, isModified: true, isAdvanceAfterSaveEnabled: advance,
        setIsModified(value) { context.isModified = value; },
        updateAnnotationSummary() {}, saveCacheToStorage() {},
        fetch() { requests++; return wait; },
        navigateImage() { moves++; },
        alert() {}, console: { error() {} }, setTimeout() {}, clearTimeout() {},
        document: { getElementById(id) {
            if (id === 'app-config') return { textContent: '{"projectName":"test"}' };
            if (id === 'approve-btn' || id === 'save-btn') return button;
            if (id === 'autosave-toast') return { classList: { toggle() {}, add() {} } };
            return null;
        } },
    });
    const source = fs.readFileSync(path.join(__dirname, '../visiofirm/static/js/saveHandling.js'), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
    vm.runInContext(source, context);
    return { context, button, statuses, status: (...args) => statuses.push(args),
        complete: () => resolve(response), requests: () => requests, moves: () => moves };
}

test('manual approval advances exactly once only when enabled', async () => {
    for (const advance of [true, false]) {
        const f = fixture({ advance });
        await f.context.approveAndMaybeAdvance(f.status);
        assert.equal(f.requests(), 1);
        assert.equal(f.moves(), advance ? 1 : 0);
        assert.equal(f.context.isModified, false);
        assert.equal(f.context.annotations[0].isPreannotation, false);
        assert.deepEqual(f.statuses, [['/images/1.jpg', true]]);
        assert.equal(f.button.disabled, false);
    }
});

test('failed save preserves edits and AI status and does not advance', async () => {
    const f = fixture({ success: false });
    await f.context.approveAndMaybeAdvance(f.status);
    assert.equal(f.moves(), 0);
    assert.equal(f.context.isModified, true);
    assert.equal(f.context.annotations[0].isPreannotation, true);
    assert.equal(f.statuses.length, 0);
    assert.equal(f.button.disabled, false);
});

test('autosave never triggers an extra advance', async () => {
    const f = fixture();
    await f.context.executeSave(true, f.status);
    assert.equal(f.moves(), 0);
});

test('repeated manual requests while saving produce one save and one advance', async () => {
    const f = fixture({ delayed: true });
    const first = f.context.approveAndMaybeAdvance(f.status);
    await f.context.approveAndMaybeAdvance(f.status);
    assert.equal(f.requests(), 1);
    assert.equal(f.button.disabled, true);
    f.complete();
    await first;
    assert.equal(f.moves(), 1);
});

test('navigation or edits during a pending save do not get overwritten or advance again', async () => {
    for (const action of ['navigate', 'edit']) {
        const f = fixture({ delayed: true });
        const pending = f.context.approveAndMaybeAdvance(f.status);
        if (action === 'navigate') f.context.currentImageKey = '/images/2.jpg';
        else f.context.annotations[0].width = 30;
        f.complete();
        await pending;
        assert.equal(f.moves(), 0);
        assert.equal(f.context.isModified, true);
        assert.deepEqual(f.statuses, [['/images/1.jpg', true]]);
    }
});
