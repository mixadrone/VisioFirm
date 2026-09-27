import { currentImageKey, currentImageIndex, thumbnailImages, setThumbnailImages, setCurrentImageIndex } from './globals.js';
import { selectImage } from './imageHandling.js';

export function switchToAnnotationView(imgElement = null) {
    console.log('Switching to annotation view');
    const gridView = document.getElementById('grid-view');
    const annotationView = document.getElementById('annotation-view');

    gridView.classList.remove('show');
    gridView.classList.add('hide');
    gridView.style.display = 'none';

    annotationView.style.display = 'flex';
    annotationView.classList.remove('hide');
    annotationView.classList.add('show');

    setTimeout(() => {
        annotationView.classList.add('show');
    }, 10);

    refreshImageList();
    const id = imgElement?.closest('[data-id]')?.dataset.id;
    const target = id
        ? thumbnailImages.find(img => img.closest('[data-id]').dataset.id === id)
        : thumbnailImages[currentImageIndex] || thumbnailImages[0];
    if (target) selectImage(target);

}

export function switchToGridView() {
    console.log('Switching to grid view');
    document.dispatchEvent(new CustomEvent('project-tab-change', { detail: 'images' }));
    const gridView = document.getElementById('grid-view');
    const annotationView = document.getElementById('annotation-view');

    annotationView.classList.remove('show');
    annotationView.classList.add('hide');
    annotationView.style.display = 'none';

    gridView.style.display = 'block';
    gridView.classList.remove('hide');
    setTimeout(() => {
        gridView.classList.add('show');
    }, 10);
    annotationView.classList.add('hide');
    document.getElementById('grid-view').classList.remove('hide');

}

export function initializeGridView() {
    const gridView = document.getElementById('grid-view');
    const annotationView = document.getElementById('annotation-view');
    gridView.style.display = 'block';
    annotationView.style.display = 'none';
    gridView.classList.add('show');
    gridView.classList.remove('hide');
    annotationView.classList.add('hide');
    annotationView.classList.remove('show');
    initializeImageList();
}

const sortTypes = ['name-asc', 'name-desc', 'status-asc', 'status-desc', 'status-pre', 'date-asc', 'date-desc', 'anno-desc', 'anno-asc', 'class-desc', 'class-asc'];
const filterTypes = ['all', 'annotated', 'preannotated', 'unannotated', 'anno-0', 'anno-1-5', 'anno-gt5', 'class-1', 'class-multi', 'custom-range'];
let activeSort = 'name-asc';
let activeFilter = 'all';
let activeClassFilter = 'all';
export let customRange = {
    annoMin: null,
    annoMax: null,
    classMin: null,
    classMax: null
};
let storageKey;
let excludedImageIndex = 0;

function imageStatus(row) {
    return row.dataset.preannotated === 'true' ? 'preannotated'
        : row.dataset.annotated === 'true' ? 'annotated' : 'unannotated';
}

function imagePath(img) {
    return new URL(img.dataset.src || img.getAttribute('src'), window.location.href).pathname;
}

export function initializeImageList() {
    const config = JSON.parse(document.getElementById('app-config').textContent);
    storageKey = `visiofirm_image_list:${config.projectName}`;
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
        if (sortTypes.includes(saved.sort)) activeSort = saved.sort;
        if (filterTypes.includes(saved.filter)) activeFilter = saved.filter;
        if (saved.customRange) customRange = { ...customRange, ...saved.customRange };
    } catch (error) {
        console.warn('Cannot restore image list preferences', error);
    }
    refreshImageList();
}

export function refreshImageList() {
    const groups = ['#grid-thumbnails .grid-card', '#list-table tbody tr', '#annotation-view .thumbnail-row'];
    const nameCompare = (a, b) => a.dataset.id.localeCompare(b.dataset.id, undefined, { numeric: true, sensitivity: 'base' })
        || a.dataset.id.localeCompare(b.dataset.id);
    const statusOrder = activeSort === 'status-desc' ? ['unannotated', 'preannotated', 'annotated']
        : activeSort === 'status-pre' ? ['preannotated', 'unannotated', 'annotated']
        : ['annotated', 'preannotated', 'unannotated'];
    const compare = (a, b) => {
        if (activeSort === 'name-desc') return -nameCompare(a, b);
        if (activeSort === 'anno-desc') {
            const countA = parseInt(a.dataset.annotationCount || '0', 10);
            const countB = parseInt(b.dataset.annotationCount || '0', 10);
            return (countB - countA) || nameCompare(a, b);
        }
        if (activeSort === 'anno-asc') {
            const countA = parseInt(a.dataset.annotationCount || '0', 10);
            const countB = parseInt(b.dataset.annotationCount || '0', 10);
            return (countA - countB) || nameCompare(a, b);
        }
        if (activeSort === 'class-desc') {
            const countA = parseInt(a.dataset.classCount || '0', 10);
            const countB = parseInt(b.dataset.classCount || '0', 10);
            return (countB - countA) || nameCompare(a, b);
        }
        if (activeSort === 'class-asc') {
            const countA = parseInt(a.dataset.classCount || '0', 10);
            const countB = parseInt(b.dataset.classCount || '0', 10);
            return (countA - countB) || nameCompare(a, b);
        }
        if (activeSort.startsWith('status-')) {
            return statusOrder.indexOf(imageStatus(a)) - statusOrder.indexOf(imageStatus(b)) || nameCompare(a, b);
        }
        if (activeSort.startsWith('date-')) {
            const aDate = Date.parse(a.dataset.date);
            const bDate = Date.parse(b.dataset.date);
            // Unknown dates stay last in either direction.
            if (Number.isFinite(aDate) !== Number.isFinite(bDate)) return Number.isFinite(aDate) ? -1 : 1;
            return ((aDate - bDate) * (activeSort === 'date-desc' ? -1 : 1)) || nameCompare(a, b);
        }
        return nameCompare(a, b);
    };
    const previousIndex = currentImageIndex;
    groups.forEach(selector => {
        const original = Array.from(document.querySelectorAll(selector));
        const rows = [...original].sort(compare);
        const orderChanged = rows.some((row, index) => row !== original[index]);
        rows.forEach(row => {
            const annoCount = parseInt(row.dataset.annotationCount || '0', 10);
            const classCount = parseInt(row.dataset.classCount || '0', 10);
            let matchesFilter = true;
            if (activeFilter === 'all') {
                matchesFilter = true;
            } else if (activeFilter === 'annotated') {
                matchesFilter = row.dataset.annotated === 'true';
            } else if (activeFilter === 'preannotated') {
                matchesFilter = row.dataset.preannotated === 'true';
            } else if (activeFilter === 'unannotated') {
                matchesFilter = row.dataset.annotated !== 'true' && row.dataset.preannotated !== 'true';
            } else if (activeFilter === 'anno-0') {
                matchesFilter = annoCount === 0;
            } else if (activeFilter === 'anno-1-5') {
                matchesFilter = annoCount >= 1 && annoCount <= 5;
            } else if (activeFilter === 'anno-gt5') {
                matchesFilter = annoCount > 5;
            } else if (activeFilter === 'class-1') {
                matchesFilter = classCount === 1;
            } else if (activeFilter === 'class-multi') {
                matchesFilter = classCount >= 2;
            } else if (activeFilter === 'custom-range') {
                if (customRange.annoMin !== null && annoCount < customRange.annoMin) matchesFilter = false;
                if (customRange.annoMax !== null && annoCount > customRange.annoMax) matchesFilter = false;
                if (customRange.classMin !== null && classCount < customRange.classMin) matchesFilter = false;
                if (customRange.classMax !== null && classCount > customRange.classMax) matchesFilter = false;
            }
            const rowClasses = (row.dataset.classes || '').split(' ').filter(Boolean);
            const matchesClass = activeClassFilter === 'all' || rowClasses.includes(activeClassFilter);
            row.hidden = !(matchesFilter && matchesClass);
            const checkbox = row.querySelector('.image-checkbox');
            if (row.hidden && checkbox) checkbox.checked = false;
            if (orderChanged) row.parentElement.appendChild(row);
        });
    });
    const visible = Array.from(document.querySelectorAll('#annotation-view .thumbnail-row'))
        .filter(row => !row.hidden);
    setThumbnailImages(visible.map(row => row.querySelector('img')));
    setCurrentImageIndex(thumbnailImages.findIndex(img => imagePath(img) === currentImageKey));
    if (currentImageIndex < 0 && previousIndex >= 0) excludedImageIndex = previousIndex;
    document.querySelectorAll('#annotation-view .thumbnail-row').forEach(row => { row.dataset.index = '-1'; });
    visible.forEach((row, index) => { row.dataset.index = String(index); });
    document.querySelectorAll('[data-sort], [data-filter]').forEach(item => {
        const selected = item.dataset.sort ? item.dataset.sort === activeSort : item.dataset.filter === activeFilter;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-current', selected ? 'true' : 'false');
    });
    ['sort-btn', 'sort-btn-annotation', 'filter-btn', 'filter-btn-annotation'].forEach(id => {
        const button = document.getElementById(id);
        if (!button) return;
        const isFilter = id.startsWith('filter');
        const item = document.querySelector(isFilter ? `[data-filter="${activeFilter}"]` : `[data-sort="${activeSort}"]`);
        let labelText = item?.textContent.trim() || '';
        if (isFilter && activeFilter === 'custom-range') {
            const parts = [];
            if (customRange.annoMin !== null || customRange.annoMax !== null) {
                parts.push(`Anno: ${customRange.annoMin ?? 0}–${customRange.annoMax ?? '∞'}`);
            }
            if (customRange.classMin !== null || customRange.classMax !== null) {
                parts.push(`Class: ${customRange.classMin ?? 0}–${customRange.classMax ?? '∞'}`);
            }
            labelText = parts.join(', ') || 'Custom Range';
        }
        button.title = `${isFilter ? 'Filter' : 'Sort'}: ${labelText}`;
        const label = button.querySelector('.image-list-control-label');
        if (label && isFilter) label.textContent = activeFilter === 'all' ? 'All Images' : labelText;
        button.classList.toggle('active', !isFilter || activeFilter !== 'all');
    });
    document.querySelectorAll('.image-list-empty').forEach(el => { el.hidden = visible.length !== 0; });
    const excluded = document.getElementById('image-filter-notice');
    if (excluded) excluded.hidden = !currentImageKey || currentImageIndex >= 0;
    ['prev-image-btn', 'next-image-btn'].forEach(id => {
        const button = document.getElementById(id);
        if (button) button.disabled = visible.length === 0;
    });
    const jumpInput = document.getElementById('image-jump-input');
    const jumpTotal = document.getElementById('image-jump-total');
    if (jumpTotal) jumpTotal.textContent = visible.length;
    if (jumpInput) {
        jumpInput.max = visible.length;
        jumpInput.disabled = visible.length === 0;
        if (currentImageIndex >= 0) {
            jumpInput.value = currentImageIndex + 1;
        }
    }
}

function savePreferences() {
    try {
        localStorage.setItem(storageKey, JSON.stringify({ sort: activeSort, filter: activeFilter, customRange }));
    } catch (error) {
        console.warn('Cannot save image list preferences', error);
    }
    refreshImageList();
}

export function sortImages(sortType) {
    if (!sortTypes.includes(sortType)) return;
    activeSort = sortType;
    savePreferences();
}

export function setCustomFilterRange(range) {
    customRange = { ...customRange, ...range };
    activeFilter = 'custom-range';
    savePreferences();
}

export function filterImages(filterType) {
    if (!filterTypes.includes(filterType)) return;
    activeFilter = filterType;
    savePreferences();
}

export function filterByClass(className) {
    activeClassFilter = className || 'all';
    refreshImageList();
}

export function navigateImage(direction) {
    // Resolve against the latest list after any previously queued image switch.
    return selectImage(() => {
        if (!thumbnailImages.length) return null;
        const index = currentImageIndex < 0 ? (excludedImageIndex + (direction > 0 ? 0 : -1) + thumbnailImages.length) % thumbnailImages.length
            : (currentImageIndex + direction + thumbnailImages.length) % thumbnailImages.length;
        return thumbnailImages[index];
    });
}

export function toggleView(viewType) {
    if (viewType === 'grid') {
        document.getElementById('grid-thumbnails').style.display = 'grid';
        document.getElementById('list-table').style.display = 'none';
        document.getElementById('grid-toggle-btn').classList.add('active');
        document.getElementById('list-toggle-btn').classList.remove('active');
    } else {
        document.getElementById('grid-thumbnails').style.display = 'none';
        document.getElementById('list-table').style.display = 'table';
        document.getElementById('grid-toggle-btn').classList.remove('active');
        document.getElementById('list-toggle-btn').classList.add('active');
    }

    document.querySelectorAll('.image-checkbox').forEach(checkbox => {
        const path = checkbox.dataset.path;
        const otherViewCheckbox = document.querySelector(
            `.image-checkbox[data-path="${path}"]:not([checked="${checkbox.checked}"])`
        );
        if (otherViewCheckbox) {
            otherViewCheckbox.checked = checkbox.checked;
        }
    });
}
