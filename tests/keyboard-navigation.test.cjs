const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
    const listeners = {};
    const moves = [];
    let saves = 0;
    const context = vm.createContext({
        document: {
            addEventListener(type, listener) { (listeners[type] ??= []).push(listener); },
            getElementById(id) { return id === 'approve-btn' ? { click() { saves++; } } : { classList: { contains: () => true } }; },
        },
        navigateImage(direction) { moves.push(direction); },
        setMode(value) { context.mode = value; },
        drawImage() {},
        selectedAnnotation: null,
        currentAnnotation: null,
        setupType: 'Bounding Box',
    });
    const source = fs.readFileSync(path.join(__dirname, '../visiofirm/static/js/keyboardShortcuts.js'), 'utf8')
        .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\r?\n/gm, '')
        .replace(/export /g, '');
    vm.runInContext(source, context);
    context.initKeyboardShortcuts();
    return {
        context, moves, saves: () => saves,
        dispatch(key, repeat = false, target = { tagName: 'BODY' }, extra = {}) {
            const event = { key, repeat, target, ctrlKey: false, preventDefault() {}, ...extra };
            for (const listener of listeners.keydown) listener(event);
        },
    };
}

test('holding either arrow queues exactly one move, even before loading completes', () => {
    for (const [key, direction] of [['ArrowRight', 1], ['ArrowLeft', -1]]) {
        const f = fixture();
        f.dispatch(key);
        for (let repeat = 0; repeat < 20; repeat++) f.dispatch(key, true);
        assert.deepEqual(f.moves, [direction]);
        // Releasing and pressing again produces a new non-repeat keydown.
        f.dispatch(key);
        assert.deepEqual(f.moves, [direction, direction]);
    }
});

test('S saves without modifiers, respects typing, and V selects instead', () => {
    const f = fixture();
    f.dispatch('s');
    f.dispatch('s', true);
    assert.equal(f.saves(), 1);
    f.dispatch('і', false, undefined, { code: 'KeyS' });
    assert.equal(f.saves(), 2);
    f.dispatch('s', false, { tagName: 'INPUT' });
    f.dispatch('s', false, { tagName: 'SELECT' });
    f.dispatch('s', false, undefined, { ctrlKey: true });
    f.dispatch('s', false, undefined, { altKey: true });
    assert.equal(f.saves(), 2);
    f.dispatch('v');
    assert.equal(f.context.mode, 'select');
    assert.equal(f.saves(), 2);
});

test('Enter saves once per press and leaves focused controls and dialogs alone', () => {
    const f = fixture();
    f.dispatch('Enter');
    f.dispatch('Enter', true);
    assert.equal(f.saves(), 1);
    f.dispatch('Enter', false, { tagName: 'INPUT' });
    f.dispatch('Enter', false, { tagName: 'BUTTON', closest: () => ({}) });
    assert.equal(f.saves(), 1);
    f.dispatch('Enter');
    assert.equal(f.saves(), 2);
});

test('reinitializing shortcuts does not multiply moves', () => {
    const f = fixture();
    f.context.initKeyboardShortcuts();
    f.context.initKeyboardShortcuts();
    f.dispatch('ArrowRight');
    f.dispatch('ArrowLeft');
    assert.deepEqual(f.moves, [1, -1]);
});

test('arrows in text fields do not switch images', () => {
    const f = fixture();
    f.dispatch('ArrowRight', false, { tagName: 'INPUT' });
    f.dispatch('ArrowLeft', false, { tagName: 'TEXTAREA' });
    f.dispatch('ArrowRight', false, { tagName: 'DIV', isContentEditable: true });
    assert.deepEqual(f.moves, []);
});
