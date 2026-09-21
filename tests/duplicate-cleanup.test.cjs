const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function fixture(scan) {
    class Element {
        constructor(){this.listeners={};this.children=[];this.style={};this.dataset={project:'demo'};}
        addEventListener(name,fn){this.listeners[name]=fn;}
        append(...children){this.children.push(...children);}
        prepend(child){this.children.unshift(child);}
        replaceChildren(){this.children=[];}
        setAttribute(){}
        showModal(){this.open=true;}
        close(){this.open=false;}
        querySelectorAll(){return this.children.flatMap(c=>[...(c.type?[c]:[]),...c.querySelectorAll()]);}
    }
    const elements={}; const button=new Element();const requests=[];let reloads=0;
    const document={getElementById:id=>elements[id]??=(new Element()),createElement:()=>new Element(),querySelectorAll:()=>[button]};
    const context={document,location:{reload(){reloads++;}},fetch:async(url,options)=>{
        requests.push({url,body:JSON.parse(options.body)});
        return {ok:true,json:async()=>url.includes('scan_')?scan:{deleted:[2],skipped:[],failed:[],warnings:[]}};
    }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../visiofirm/static/js/duplicateCleanup.js'),'utf8'),context);
    return {elements,requests,reloads:()=>reloads,open:()=>button.listeners.click({stopPropagation(){}})};
}
const member=(id,extra={})=>({image_id:id,name:`tile${id}.png`,width:10,height:10,bytes:100,annotations:0,preannotations:0,reviewed:false,url:'/image.png',state:'state',...extra});

test('empty scan disables cleanup and shows no duplicates',async()=>{
    const f=fixture({groups:[],skipped:[],scanned:3});await f.open();
    assert.equal(f.elements['duplicates-clean'].disabled,true);
    assert.match(f.elements['duplicates-status'].textContent,/No repeated source filenames/);
});

test('conflicts default to skipped and annotation loss requires explicit checkbox',async()=>{
    const f=fixture({groups:[{members:[member(1,{reviewed:true}),member(2,{annotations:1})],keep_id:1,conflict:true,token:'signed'}],skipped:[],scanned:2});await f.open();
    assert.equal(f.elements['duplicates-clean'].disabled,true);
    const inputs=f.elements['duplicates-groups'].querySelectorAll();
    const include=inputs.find(i=>i.type==='checkbox'); include.checked=true;include.listeners.change();
    assert.equal(f.elements['duplicates-loss-label'].hidden,false);
    assert.equal(f.elements['duplicates-clean'].disabled,true);
    f.elements['duplicates-loss'].checked=true;f.elements['duplicates-loss'].listeners.change();
    assert.equal(f.elements['duplicates-clean'].disabled,false);
    await f.elements['duplicates-clean'].listeners.click();
    assert.equal(f.requests[1].body.confirm_loss,true);
    assert.deepEqual(f.requests[1].body.groups[0].remove_ids,[2]);
    assert.match(f.elements['duplicates-status'].textContent,/Deleted 1 files/);
    f.elements['duplicates-close'].listeners.click();assert.equal(f.reloads(),1);
});

test('manual keeper selection changes removal IDs without merging annotations',async()=>{
    const f=fixture({groups:[{members:[member(1),member(2)],keep_id:1,conflict:false,token:'signed'}],skipped:[],scanned:2});await f.open();
    const radios=f.elements['duplicates-groups'].querySelectorAll().filter(i=>i.type==='radio');radios[1].listeners.change();
    await f.elements['duplicates-clean'].listeners.click();
    assert.equal(f.requests[1].body.groups[0].keep_id,2);
    assert.deepEqual(f.requests[1].body.groups[0].remove_ids,[1]);
});
