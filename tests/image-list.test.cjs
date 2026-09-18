// Run with: node --test tests/image-list.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(saved = null) {
    const inputs = [
        ['img_10.jpg', 'false', 'false', '2026-09-10'],
        ['img_2.jpg', 'false', 'true', '2026-09-02'],
        ['img_1.jpg', 'true', 'true', '2026-09-01'],
        ['img_3 space.jpg', 'false', 'false', ''],
    ];
    const selectors = ['#grid-thumbnails .grid-card', '#list-table tbody tr', '#annotation-view .thumbnail-row'];
    const groups = {};
    for (const selector of selectors) {
        const rows = [];
        const parent = { appendChild(row) { rows.splice(rows.indexOf(row), 1); rows.push(row); } };
        for (const [id, annotated, preannotated, date] of inputs) {
            const row = { dataset: { id, annotated, preannotated, date, imageId: String(rows.length + 20) }, parentElement: parent };
            row.img = { dataset: { src: `/projects/demo/images/${id}` }, closest: () => row };
            row.checkbox = { checked: true };
            row.querySelector = selector => selector === '.image-checkbox' ? row.checkbox : row.img;
            rows.push(row);
        }
        groups[selector] = rows;
    }
    const elements = {
        'app-config': { textContent: '{"projectName":"demo"}' },
        'image-filter-notice': {}, 'prev-image-btn': {}, 'next-image-btn': {},
    };
    const empty = [{}, {}];
    let stored = saved;
    const context = vm.createContext({
        URL, console: { ...console, warn() {} }, window: { location: { href: 'http://localhost/' } },
        document: {
            querySelectorAll: selector => groups[selector] || (selector === '.image-list-empty' ? empty : []),
            getElementById: id => elements[id],
        },
        localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value; } },
        currentImageKey: '/projects/demo/images/img_2.jpg', currentImageIndex: -1, thumbnailImages: [],
        setThumbnailImages(value) { context.thumbnailImages = value; },
        setCurrentImageIndex(value) { context.currentImageIndex = value; },
        selectImage(value) {
            const img = typeof value === 'function' ? value() : value;
            if (!img) return;
            context.currentImageKey = new URL(img.dataset.src, 'http://localhost/').pathname;
            context.currentImageIndex = context.thumbnailImages.indexOf(img);
        },
    });
    const source = fs.readFileSync(path.join(__dirname, '../visiofirm/static/js/viewManagement.js'), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
    vm.runInContext(source, context);
    context.initializeImageList();
    return { context, groups, elements, empty, stored: () => JSON.parse(stored), names: () => Array.from(context.thumbnailImages, img => img.closest().dataset.id) };
}

test('natural order stays synchronized across all views without changing database IDs', () => {
    const f = fixture();
    assert.deepEqual(f.names(), ['img_1.jpg', 'img_2.jpg', 'img_3 space.jpg', 'img_10.jpg']);
    assert.equal(f.context.currentImageIndex, 1);
    f.context.sortImages('name-desc');
    for (const rows of Object.values(f.groups)) {
        assert.deepEqual(rows.map(row => row.dataset.id), f.names());
        assert.equal(rows.find(row => row.dataset.id === 'img_10.jpg').dataset.imageId, '20');
    }
    assert.equal(f.context.currentImageIndex, 2);
    assert.equal(f.stored().sort, 'name-desc');
});

test('filters use exclusive status with reviewed images taking precedence', () => {
    const f = fixture();
    for (const [filter, expected] of [['annotated', ['img_1.jpg']], ['preannotated', ['img_2.jpg']], ['unannotated', ['img_3 space.jpg', 'img_10.jpg']]]) {
        f.context.filterImages(filter);
        assert.deepEqual(f.names(), expected);
        for (const rows of Object.values(f.groups)) assert.deepEqual(rows.filter(row => !row.hidden).map(row => row.dataset.id), expected);
    }
    assert.ok(Object.values(f.groups).every(rows => rows.filter(row => row.hidden).every(row => !row.checkbox.checked)));
    assert.equal(f.context.currentImageIndex, -1);
    assert.equal(f.elements['image-filter-notice'].hidden, false);
    f.context.navigateImage(1);
    assert.equal(f.context.currentImageKey, '/projects/demo/images/img_3%20space.jpg');
    f.context.refreshImageList();
    assert.equal(f.context.currentImageIndex, 0);
    f.context.navigateImage(-1);
    assert.equal(f.context.currentImageKey, '/projects/demo/images/img_10.jpg');
    f.context.navigateImage(1);
    assert.equal(f.context.currentImageIndex, 0);
});

test('all status and date orders have deterministic natural-name ties', () => {
    const f = fixture();
    for (const [sort, expected] of [
        ['status-asc', ['img_1.jpg', 'img_2.jpg', 'img_3 space.jpg', 'img_10.jpg']],
        ['status-desc', ['img_3 space.jpg', 'img_10.jpg', 'img_2.jpg', 'img_1.jpg']],
        ['status-pre', ['img_2.jpg', 'img_3 space.jpg', 'img_10.jpg', 'img_1.jpg']],
        ['date-asc', ['img_1.jpg', 'img_2.jpg', 'img_10.jpg', 'img_3 space.jpg']],
        ['date-desc', ['img_10.jpg', 'img_2.jpg', 'img_1.jpg', 'img_3 space.jpg']],
    ]) {
        f.context.sortImages(sort);
        assert.deepEqual(f.names(), expected);
    }
});

test('status updates, empty results and restored preferences rebuild navigation safely', () => {
    const f = fixture('{"sort":"name-desc","filter":"preannotated"}');
    assert.deepEqual(f.names(), ['img_2.jpg']);
    for (const rows of Object.values(f.groups)) rows.find(row => row.dataset.id === 'img_2.jpg').dataset.annotated = 'true';
    f.context.refreshImageList();
    assert.deepEqual(f.names(), []);
    assert.equal(f.elements['next-image-btn'].disabled, true);
    assert.ok(f.empty.every(el => !el.hidden));
    f.context.navigateImage(1);
    assert.equal(f.context.currentImageKey, '/projects/demo/images/img_2.jpg');
    f.context.filterImages('all');
    assert.equal(f.elements['next-image-btn'].disabled, false);
    assert.equal(f.context.currentImageIndex, 2);
    const restored = fixture(JSON.stringify(f.stored()));
    assert.deepEqual(restored.names(), f.names());
    assert.equal(fixture('invalid json').names().length, 4);
});

test('Next continues at the removed image position after approval instead of restarting', () => {
    const f = fixture();
    for (const rows of Object.values(f.groups)) rows.find(row => row.dataset.id === 'img_1.jpg').dataset.annotated = 'false';
    for (const rows of Object.values(f.groups)) rows.find(row => row.dataset.id === 'img_1.jpg').dataset.preannotated = 'false';
    f.context.filterImages('unannotated');
    f.context.currentImageKey = '/projects/demo/images/img_3%20space.jpg';
    f.context.refreshImageList();
    for (const rows of Object.values(f.groups)) rows.find(row => row.dataset.id === 'img_3 space.jpg').dataset.annotated = 'true';
    f.context.refreshImageList();
    f.context.navigateImage(1);
    assert.equal(f.context.currentImageKey, '/projects/demo/images/img_10.jpg');
});

test('status refresh does not detach and reinsert unchanged rows', () => {
    const f = fixture();
    let moves = 0;
    for (const rows of Object.values(f.groups)) rows[0].parentElement.appendChild = () => { moves++; };
    f.context.refreshImageList();
    assert.equal(moves, 0);
});
