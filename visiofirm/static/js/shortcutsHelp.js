import { setupType } from './globals.js';

export function updateShortcutsNotice() {
    const shortcutsList = document.querySelector('.shortcuts-list');
    const shortcutsLegend = document.querySelector('.shortcuts-legend');
    if (!shortcutsList) return;
    shortcutsList.innerHTML = '';
    
    // Hide old legend block if present
    if (shortcutsLegend) {
        shortcutsLegend.innerHTML = '';
        shortcutsLegend.style.display = 'none';
    }

    const shortcuts = [
        // Mode Shortcuts
        { keys: ['R'], desc: 'Draw Rectangle (Box)', icon: 'fa-solid fa-vector-square' },
        ...(setupType === 'Segmentation' ? [{ keys: ['P'], desc: 'Draw Polygon', icon: 'fa-solid fa-draw-polygon' }] : []),
        { keys: ['M'], desc: 'Magic SAM Tool', icon: 'fa-solid fa-wand-magic-sparkles' },
        { keys: ['V'], desc: 'Select / Marquee Lasso', icon: 'fa-solid fa-arrow-pointer' },
        { keys: ['Shift', 'Drag'], desc: 'Add to Selection (+)', icon: 'fa-solid fa-plus' },
        { keys: ['Alt', 'Drag'], desc: 'Subtract from Selection (-)', icon: 'fa-solid fa-minus' },
        { keys: ['Ctrl', 'Click'], desc: 'Toggle Selection (XOR)', icon: 'fa-solid fa-arrows-spin' },
        { keys: ['H', 'Space'], desc: 'Pan Canvas', icon: 'fa-solid fa-hand', isOr: true },

        // Actions & History
        { keys: ['S', 'Enter'], desc: 'Approve & Save', icon: 'fa-solid fa-check', isOr: true },
        { keys: ['Ctrl', 'Z'], desc: 'Undo Action', icon: 'fa-solid fa-rotate-left' },
        { keys: ['Ctrl', 'D'], desc: 'Duplicate Annotation', icon: 'fa-solid fa-copy' },
        { keys: ['Del'], desc: 'Delete Selected', icon: 'fa-solid fa-trash' },
        { keys: ['1 - 9'], desc: 'Quick Class Select', icon: 'fa-solid fa-tag' },

        // Navigation & View
        { keys: ['A', 'D'], desc: 'Previous / Next Image', icon: 'fa-solid fa-arrow-right-arrow-left', isOr: true },
        { keys: ['Scroll'], desc: 'Zoom Canvas', icon: 'fa-solid fa-magnifying-glass' },
        { keys: ['Alt', 'Scroll'], desc: 'Fine Zoom', icon: 'fa-solid fa-magnifying-glass-plus' },
        { keys: ['0'], desc: 'Reset View (100%)', icon: 'fa-solid fa-expand' },
        { keys: ['Ctrl', 'C'], desc: 'Copy Annotations', icon: 'fa-solid fa-clone' },
        { keys: ['Ctrl', 'V'], desc: 'Paste Annotations', icon: 'fa-solid fa-paste' },
        { keys: ['Hold R', 'Drag'], desc: 'Rotate OBB Box', icon: 'fa-solid fa-rotate-right' }
    ];

    if (setupType === 'Segmentation') {
        shortcuts.push({ keys: ['Esc'], desc: 'Close Polygon', icon: 'fa-solid fa-check-double' });
    }

    shortcuts.forEach(shortcut => {
        const row = document.createElement('div');
        row.className = 'shortcut-row';

        const descSpan = document.createElement('span');
        descSpan.className = 'shortcut-desc';
        descSpan.innerHTML = `<i class="${shortcut.icon}"></i> <span>${shortcut.desc}</span>`;

        const keysSpan = document.createElement('span');
        keysSpan.className = 'shortcut-keys';

        shortcut.keys.forEach((key, index) => {
            const kbd = document.createElement('kbd');
            kbd.className = 'kbd-badge';
            kbd.textContent = key;
            keysSpan.appendChild(kbd);

            if (index < shortcut.keys.length - 1) {
                const sep = document.createElement('span');
                sep.className = 'kbd-sep';
                sep.textContent = shortcut.isOr ? ' / ' : ' + ';
                keysSpan.appendChild(sep);
            }
        });

        row.appendChild(descSpan);
        row.appendChild(keysSpan);
        shortcutsList.appendChild(row);
    });
}

export function initShortcutsSidebar() {
    const sidebar = document.querySelector('.shortcuts-sidebar');
    if (sidebar) {
        sidebar.classList.add('collapsed');
    } else {
        return;
    }

    const toggle = document.querySelector('.shortcuts-toggle');
    const closeBtn = sidebar.querySelector('.shortcuts-close-btn');

    const close = () => {
        sidebar.classList.add('collapsed');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
    };

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            close();
        });
    }

    if (toggle) {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isCollapsed = sidebar.classList.contains('collapsed');
            if (isCollapsed) {
                sidebar.classList.remove('collapsed');
                toggle.setAttribute('aria-expanded', 'true');
            } else {
                close();
            }
        });

        document.addEventListener('click', (event) => {
            if (!sidebar.contains(event.target) && !toggle.contains(event.target)) {
                close();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !sidebar.classList.contains('collapsed')) {
                close();
                toggle.focus();
            }
        });
    }
}
