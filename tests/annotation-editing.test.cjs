const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(mode = 'rect', zoom = 1, annotation = { type: 'rect', x: 100, y: 100, width: 100, height: 100, label: 'a' }) {
    const listeners = {};
    const c = vm.createContext({
        localStorage: { getItem: () => null },
        document: { querySelectorAll: () => [] },
        window: { addEventListener: (name, fn) => { listeners[name] = fn; } },
        drawImage() {}, setHoveredAnnotation() {},
        inputAnnotation: annotation,
    });
    for (const file of ['globals.js', 'annotationCore.js', 'annotationInteraction.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../visiofirm/static/js', file), 'utf8')
            .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\r?\n/gm, '').replace(/export /g, ''), c);
    }
    const run = code => vm.runInContext(code, c);
    run(`canvas={style:{},addEventListener(){},getBoundingClientRect:()=>({left:0,top:0})};
        currentImage={width:1000,height:1000}; currentImageKey='test';
        updateTagHighlights=()=>{}; viewport.zoom=${zoom}; viewport.x=0; viewport.y=0;
        mode='${mode}'; setupType='Bounding Box'; annotations=[inputAnnotation];`);
    c.initAnnotationInteraction();
    const event = (x, y, button = 0) => ({ clientX: x * zoom, clientY: y * zoom, button, preventDefault() {} });
    return { c, run, listeners, annotation,
        down: (x,y,b=0) => c.handleMouseDown(event(x,y,b)),
        move: (x,y) => c.handleMouseMove(event(x,y)),
        up: () => c.handleMouseUp(event(0,0)),
    };
}

test('all box handles resize with either button in Rect and Select at multiple zooms', () => {
    const handles = [[100,100,-10,-10],[200,100,10,-10],[100,200,-10,10],[200,200,10,10],
        [150,100,0,-10],[150,200,0,10],[100,150,-10,0],[200,150,10,0]];
    for (const mode of ['rect', 'select']) for (const zoom of [1, 9]) for (const button of [0,2]) {
        for (const [x,y,dx,dy] of handles) {
            const f = fixture(mode, zoom);
            f.down(x,y,button);
            assert.equal(f.run('isModified'), false);
            f.move(x+dx,y+dy);
            f.move(x+dx*2,y+dy*2);
            f.up();
            assert.equal(f.annotation.width, dx ? 120 : 100);
            assert.equal(f.annotation.height, dy ? 120 : 100);
            assert.equal(f.run('annotations.length'), 1);
            assert.equal(f.run('undoStack.test.length'), 1);
            assert.equal(f.run('undoStack.test[0][0].width'), 100);
            assert.equal(f.run('isModified'), true);
            assert.equal(f.run('viewport.zoom'), zoom);
        }
    }
});

test('selection and no-op dragging do not mark edits or create undo entries', () => {
    for (const mode of ['rect','select','polygon']) for (const button of [0,2]) {
        const f = fixture(mode);
        f.down(150,150,button); f.move(150,150); f.up();
        assert.equal(f.run('isModified'), false);
        assert.equal(f.run('undoStack.test'), undefined);
        assert.equal(f.run('selectedAnnotation === annotations[0]'), true);
    }
});

test('body dragging moves the object and release outside canvas ends editing', () => {
    const f = fixture();
    f.down(150,150); f.move(170,180);
    assert.equal(f.annotation.x,120); assert.equal(f.annotation.y,130);
    f.listeners.mouseup(); f.move(190,200);
    assert.equal(f.annotation.x,120);
    assert.equal(f.run('isDragging'),false);
    assert.equal(f.run('undoStack.test[0][0].x'),100);
});

test('empty clicks deselect; empty drags create a new box', () => {
    const f = fixture();
    f.down(150,150); f.up(); f.down(400,400); f.up();
    assert.equal(f.run('selectedAnnotation'),null);
    assert.equal(f.run('isModified'),false);
    f.down(400,400); f.move(450,460); f.up();
    assert.equal(f.run('annotations.length'),2);
    assert.equal(f.run('annotations[1].width'),50);
});

test('polygon vertices edit and clamp at image bounds', () => {
    const f = fixture('polygon',9,{type:'polygon',label:'a',points:[{x:100,y:100},{x:200,y:100},{x:150,y:200}]});
    f.down(100,100); f.move(-10,50); f.up();
    assert.equal(f.annotation.points[0].x,0);
    assert.equal(f.annotation.points[0].y,50);
    assert.equal(f.run('undoStack.test.length'),1);
});

test('rotated OBB body hit testing uses inverse rotation and corners resize', () => {
    const f = fixture('rect',4,{type:'obbox',x:100,y:100,width:200,height:40,rotation:45,label:'a'});
    f.run(`setupType='Oriented Bounding Box'`);
    assert.equal(f.c.isPointInAnnotation({x:260*4,y:180*4},f.annotation),true);
    assert.equal(f.c.isPointInAnnotation({x:260*4,y:60*4},f.annotation),false);
    const corner = f.c.getRotatedCorners(f.annotation)[0];
    f.down(corner.x,corner.y); f.move(corner.x-10,corner.y-10); f.up();
    assert.ok(f.annotation.width>200);
    assert.equal(f.run('undoStack.test.length'),1);
});

test('hidden labels are not edited and hover cursor identifies the right edge', () => {
    const f = fixture();
    f.down(150,150); f.up(); f.move(200,150);
    assert.equal(f.run('canvas.style.cursor'),'ew-resize');
    f.run(`hiddenAnnotationLabels.add('a')`);
    f.down(150,150); f.move(170,180); f.up();
    assert.equal(f.annotation.x,100);
});
