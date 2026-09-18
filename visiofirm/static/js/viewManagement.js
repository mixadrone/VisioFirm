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

    document.querySelectorAll('#annotation-view .lazy-load').forEach(img => {
        if (!img.src) {
            img.src = img.dataset.src;
        }
    });

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

const sortTypes = ['name-asc', 'name-desc', 'status-asc', 'status-desc', 'status-pre', 'date-asc', 'date-desc'];
const filterTypes = ['all', 'annotated', 'preannotated', 'unannotated'];
let activeSort = 'name-asc';
let activeFilter = 'all';
let storageKey;
let excludedImageIndex = 0;

function imageStatus(row) {
    return row.dataset.annotated === 'true' ? 'annotated'
        : row.dataset.preannotated === 'true' ? 'preannotated' : 'unannotated';
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
            row.hidden = activeFilter !== 'all' && imageStatus(row) !== activeFilter;
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
        button.title = `${isFilter ? 'Filter' : 'Sort'}: ${item?.textContent.trim() || ''}`;
        const label = button.querySelector('.image-list-control-label');
        if (label && isFilter) label.textContent = activeFilter === 'all' ? 'All Images' : item.textContent.trim();
        button.classList.toggle('active', !isFilter || activeFilter !== 'all');
    });
    document.querySelectorAll('.image-list-empty').forEach(el => { el.hidden = visible.length !== 0; });
    const excluded = document.getElementById('image-filter-notice');
    if (excluded) excluded.hidden = !currentImageKey || currentImageIndex >= 0;
    ['prev-image-btn', 'next-image-btn'].forEach(id => {
        const button = document.getElementById(id);
        if (button) button.disabled = visible.length === 0;
    });
}

function savePreferences() {
    try {
        localStorage.setItem(storageKey, JSON.stringify({ sort: activeSort, filter: activeFilter }));
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

export function filterImages(filterType) {
    if (!filterTypes.includes(filterType)) return;
    activeFilter = filterType;
    savePreferences();
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