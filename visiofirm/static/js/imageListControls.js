export function initializeImageListControls({ sortImages, filterImages, setCustomFilterRange, onChange }) {
    if (document.documentElement.dataset.imageListControlsInitialized === 'true') return;
    const menus = Array.from(document.querySelectorAll('.image-list-dropdown'));
    if (!menus.length) return;
    document.documentElement.dataset.imageListControlsInitialized = 'true';
    function closeMenus() {
        menus.forEach(menu => {
            menu.classList.remove('is-open');
            menu.querySelector('button').setAttribute('aria-expanded', 'false');
        });
    }
    menus.forEach(menu => {
        const button = menu.querySelector('button');
        button.setAttribute('aria-expanded', 'false');
        button.addEventListener('click', () => {
            const wasOpen = menu.classList.contains('is-open');
            closeMenus();
            if (!wasOpen) {
                menu.classList.add('is-open');
                button.setAttribute('aria-expanded', 'true');
            }
        });
        menu.querySelectorAll('a[data-sort], a[data-filter]').forEach(item => {
            item.addEventListener('click', event => {
                event.preventDefault();
                if (item.dataset.sort) sortImages(item.dataset.sort);
                else filterImages(item.dataset.filter);
                closeMenus();
                button.focus();
                onChange();
            });
        });
        menu.querySelectorAll('.filter-range-block').forEach(block => {
            block.addEventListener('click', event => event.stopPropagation());
        });
        menu.querySelectorAll('.filter-range-apply-btn').forEach(btn => {
            btn.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const container = btn.closest('.filter-range-block');
                const annoMinVal = container.querySelector('.filter-range-anno-min')?.value.trim();
                const annoMaxVal = container.querySelector('.filter-range-anno-max')?.value.trim();
                const classMinVal = container.querySelector('.filter-range-class-min')?.value.trim();
                const classMaxVal = container.querySelector('.filter-range-class-max')?.value.trim();

                const annoMin = annoMinVal !== '' && !isNaN(Number(annoMinVal)) ? parseInt(annoMinVal, 10) : null;
                const annoMax = annoMaxVal !== '' && !isNaN(Number(annoMaxVal)) ? parseInt(annoMaxVal, 10) : null;
                const classMin = classMinVal !== '' && !isNaN(Number(classMinVal)) ? parseInt(classMinVal, 10) : null;
                const classMax = classMaxVal !== '' && !isNaN(Number(classMaxVal)) ? parseInt(classMaxVal, 10) : null;

                document.querySelectorAll('.filter-range-anno-min').forEach(inp => { inp.value = annoMinVal || ''; });
                document.querySelectorAll('.filter-range-anno-max').forEach(inp => { inp.value = annoMaxVal || ''; });
                document.querySelectorAll('.filter-range-class-min').forEach(inp => { inp.value = classMinVal || ''; });
                document.querySelectorAll('.filter-range-class-max').forEach(inp => { inp.value = classMaxVal || ''; });

                if (setCustomFilterRange) {
                    setCustomFilterRange({ annoMin, annoMax, classMin, classMax });
                }
                closeMenus();
                button.focus();
                onChange();
            });
        });
        menu.querySelectorAll('.filter-range-reset-btn').forEach(btn => {
            btn.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                document.querySelectorAll('.filter-range-anno-min, .filter-range-anno-max, .filter-range-class-min, .filter-range-class-max').forEach(inp => { inp.value = ''; });
                filterImages('all');
                closeMenus();
                button.focus();
                onChange();
            });
        });
        menu.querySelectorAll('.filter-num-input').forEach(inp => {
            inp.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    const applyBtn = inp.closest('.filter-range-block')?.querySelector('.filter-range-apply-btn');
                    if (applyBtn) applyBtn.click();
                }
            });
        });
    });
    document.addEventListener('click', event => {
        if (!event.target.closest('.image-list-dropdown')) closeMenus();
    });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const open = menus.find(menu => menu.classList.contains('is-open'));
        if (open) {
            closeMenus();
            open.querySelector('button').focus();
            event.preventDefault();
        }
    });
}
