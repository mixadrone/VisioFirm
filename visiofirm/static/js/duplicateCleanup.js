// Project duplicate cleanup: scan, review, then explicitly remove selected copies.
(() => {
    const dialog = document.getElementById('duplicates-dialog');
    const status = document.getElementById('duplicates-status');
    const container = document.getElementById('duplicates-groups');
    const selectAll = document.getElementById('duplicates-select-all');
    const selectAllLabel = document.getElementById('duplicates-select-all-label');
    let groupCheckboxes = [];
    const summary = document.getElementById('duplicates-summary');
    const loss = document.getElementById('duplicates-loss');
    const lossLabel = document.getElementById('duplicates-loss-label');
    const clean = document.getElementById('duplicates-clean');
    const close = document.getElementById('duplicates-close');
    const result = document.getElementById('duplicates-result');
    function showResult(message, kind) {
        result.textContent = message;
        result.dataset.kind = kind;
        result.hidden = false;
        result.scrollIntoView({block: 'nearest'});
    }
    let project, groups = [], busy = false, changed = false, finished = false;
    const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
    const size = bytes => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    const selected = () => groups.filter(group => group.enabled).flatMap(group => group.members.filter(m => m.image_id !== group.keep_id));
    function update() {
        const enabledCount = groups.filter(group => group.enabled).length;
        selectAllLabel.hidden = finished || !groups.length;
        selectAll.disabled = busy || finished || !groups.length;
        selectAll.checked = groups.length > 0 && enabledCount === groups.length;
        selectAll.indeterminate = enabledCount > 0 && enabledCount < groups.length;
        groupCheckboxes.forEach((checkbox, index) => { checkbox.checked = groups[index].enabled; });
        summary.hidden = finished;
        clean.hidden = finished;
        clean.textContent = busy ? 'Processing…' : 'Remove selected duplicates';
        close.textContent = finished && changed ? 'Done — refresh project' : 'Close';
        const items = selected();
        const manual = items.reduce((n,m) => n + m.annotations, 0);
        const predicted = items.reduce((n,m) => n + m.preannotations, 0);
        const reviewed = items.filter(m => m.reviewed).length;
        summary.textContent = `To remove: ${items.length} files, ${size(items.reduce((n,m) => n + m.bytes, 0))}, ${manual} manual annotations, ${predicted} AI predictions, ${reviewed} reviewed images.`;
        lossLabel.hidden = finished || !(manual || reviewed);
        clean.disabled = busy || finished || !items.length || (!lossLabel.hidden && !loss.checked);
    }
    async function request(action, body) {
        const response = await fetch(`/dashboard/${action}/${encodeURIComponent(project)}`, {
            method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body || {}),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Request failed');
        return data;
    }
    function render() {
        container.replaceChildren();
        groupCheckboxes = [];
        groups.forEach((group,index) => {
            const field = document.createElement('fieldset');
            field.style.marginBottom = '16px';
            field.append(element('legend', `Group ${index+1} — ${group.source_name || "Source"}${group.conflict ? ' — conflicting reviewed/manual copies; skipped by default' : ''}`));
            const enableLabel = element('label',' Include this group');
            const enable = document.createElement('input'); enable.type='checkbox'; enable.checked=group.enabled;
            groupCheckboxes.push(enable);
            enable.addEventListener('change',()=>{group.enabled=enable.checked; loss.checked=false; update();});
            enableLabel.prepend(enable); field.append(enableLabel);
            group.members.forEach(member => {
                const row = document.createElement('label');
                row.style.cssText='display:flex;align-items:center;gap:12px;padding:10px;overflow-wrap:anywhere';
                const radio=document.createElement('input'); radio.type='radio'; radio.name=`duplicate-${index}`;
                radio.checked=member.image_id===group.keep_id;
                radio.setAttribute('aria-label',`Keep ${member.name}`);
                radio.addEventListener('change',()=>{group.keep_id=member.image_id;loss.checked=false;update();});
                const image=document.createElement('img'); image.src=member.url; image.alt=member.name;
                image.loading='lazy'; image.style.cssText='width:96px;height:72px;object-fit:contain';
                const tile=member.name.match(/^(.*)_x(\d+)_y(\d+)\.[^.]+$/i);
                const info=element('span',`Keep: ${member.name} · ${member.width}×${member.height} · ${size(member.bytes)} · ${member.reviewed ? 'Reviewed' : 'Not reviewed'} · ${member.annotations} manual · ${member.preannotations} AI${tile ? ` · Source: ${tile[1]}, tile (${tile[2]}, ${tile[3]})` : ''}`);
                row.append(radio,image,info);field.append(row);
            });
            container.append(field);
        });
        update();
    }
    document.querySelectorAll('.duplicates-btn').forEach(button => button.addEventListener('click',async event => {
        event.stopPropagation();
        if (busy) return;
        project=button.dataset.project;groups=[];groupCheckboxes=[];changed=false;finished=false;busy=true;loss.checked=false;
        result.hidden=true;container.replaceChildren();status.textContent='Scanning images…';update();dialog.showModal();
        close.disabled=true;
        try {
            const data=await request('scan_duplicates');
            groups=data.groups.map(group=>({...group,enabled:!group.conflict}));
            status.textContent=`Scanned ${data.scanned} images. ${groups.length ? `${groups.length} source filename groups found.` : 'No repeated source filenames found.'} ${data.skipped.length} files skipped.`;
            render();
            data.skipped.forEach(item=>container.append(element('p',`Skipped image ${item.image_id}: ${item.reason}`)));
        } catch(error) {status.textContent=error.message;}
        finally {busy=false;close.disabled=false;update();}
    }));
    selectAll.addEventListener('change', () => {
        if (busy || finished || !groups.length) return;
        groups.forEach(group => { group.enabled = selectAll.checked; });
        loss.checked = false;
        update();
    });
    loss.addEventListener('change',update);
    clean.addEventListener('click',async()=>{
        if (clean.disabled) return;
        const selection=groups.filter(group=>group.enabled).map(group=>({members:group.members,token:group.token,keep_id:group.keep_id,remove_ids:group.members.filter(m=>m.image_id!==group.keep_id).map(m=>m.image_id)}));
        busy=true;close.disabled=true;update();
        showResult('Removing selected files… Please wait.', 'pending');
        container.querySelectorAll('input').forEach(input=>{input.disabled=true;});
        try {
            const data=await request('clean_duplicates',{groups:selection,confirm_loss:loss.checked});
            changed=data.deleted.length>0;finished=true;
            const hasIssues = data.skipped.length || data.failed.length || data.warnings.length;
            showResult(`${hasIssues ? 'Cleanup completed with issues.' : 'Cleanup completed.'} Deleted ${data.deleted.length} files. Skipped ${data.skipped.length} groups; failed ${data.failed.length} groups; ${data.warnings.length} warnings.`, hasIssues || !changed ? 'warning' : 'success');
            status.textContent=`Deleted ${data.deleted.length} files. Skipped ${data.skipped.length} groups; failed ${data.failed.length} groups. Close to refresh the project. Scan again for any remaining groups.`;
            for(const item of [...data.skipped,...data.failed]) result.append(element('p',`${item.image_ids.join(', ')}: ${item.reason}`));
            data.warnings.forEach(message=>result.append(element('p',message)));
        } catch(error) {
            status.textContent=`${error.message}. Close and scan again before retrying.`;
            changed=true;finished=true;
            showResult(`Could not confirm cleanup: ${error.message}. Close and scan again to check which files remain.`, 'error');
        } finally {busy=false;close.disabled=false;update();}
    });
    function dismiss() {if(busy)return;dialog.close();if(changed)location.reload();}
    close.addEventListener('click',dismiss);
    dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
})();
