export function initializeImageListControls({ sortImages, filterImages, onChange }) {
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
