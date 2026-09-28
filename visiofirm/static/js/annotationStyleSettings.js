import { drawImage, fitToLabels, resetView } from './annotationDrawing.js';
import {
    isFitToLabelsEnabled, setIsFitToLabelsEnabled,
    isAutoSaveEnabled, setIsAutoSaveEnabled,
    isAdvanceAfterSaveEnabled, setIsAdvanceAfterSaveEnabled,
    isCardShowDots, setIsCardShowDots,
    isCardShowFilename, setIsCardShowFilename,
    isCardShowDate, setIsCardShowDate,
    isCardShowStatus, setIsCardShowStatus
} from './globals.js';
import {
    getCurrentStyleConfig,
    getDefaultStyleConfig,
    getResolvedClassStyle,
    normalizeStyleConfig,
    setCurrentStyleConfig,
    hexToRgba,
    structuredCloneSafe,
} from './annotationStyles.js';

export function applyCardDisplaySettings() {
    // 1. Class dots
    document.querySelectorAll('.card-class-dots').forEach(el => {
        el.style.display = isCardShowDots ? 'flex' : 'none';
    });

    // 2. Filename vs ID
    document.querySelectorAll('#grid-thumbnails .image-id').forEach(el => {
        const fullFilename = el.dataset.filename || el.getAttribute('title') || '';
        const idNum = el.dataset.idNum || '';
        el.textContent = isCardShowFilename ? fullFilename : (idNum || fullFilename);
    });

    // 3. File date
    document.querySelectorAll('.card-info .image-date').forEach(el => {
        el.style.display = isCardShowDate ? 'inline-block' : 'none';
    });

    // 4. Status text badge
    document.querySelectorAll('.card-info .image-status').forEach(el => {
        el.style.display = isCardShowStatus ? 'inline-flex' : 'none';
    });
}

export function initAnnotationStyleSettings(config) {
    // Support inline panel mode (no modal) — only saveBtn is required
    const saveBtn = document.getElementById('annotation-style-save-btn');
    if (!saveBtn) return;

    const classes = Array.isArray(config.classes) ? config.classes : [];
    let draftConfig = normalizeStyleConfig(config.annotationStyleConfig, classes);
    setCurrentStyleConfig(draftConfig, classes);

    const closeBtn = document.getElementById('annotation-style-close-btn');
    const resetBtn = document.getElementById('annotation-style-reset-btn');
    const errorBox = document.getElementById('annotation-style-error');
    const jsonEditor = document.getElementById('annotation-style-json-editor');
    const classRows = document.getElementById('annotation-style-class-rows');
    const defaultRenderMode = document.getElementById('style-default-render-mode');
    const defaultStrokeWidth = document.getElementById('style-default-stroke-width');
    const defaultFillOpacity = document.getElementById('style-default-fill-opacity');
    const selectedStrokeWidth = document.getElementById('style-selected-stroke-width');
    const selectedStrokeColor = document.getElementById('style-selected-stroke-color');
    const preannotationFillOpacity = document.getElementById('style-preannotation-fill-opacity');

    // Workflow switches
    const autoSaveSwitch = document.getElementById('setting-autosave-switch');
    const fitToLabelsSwitch = document.getElementById('setting-fit-to-labels');
    const advanceAfterSaveSwitch = document.getElementById('setting-advance-after-save');

    // Gallery cards switches
    const cardDotsSwitch = document.getElementById('setting-card-dots');
    const cardFilenameSwitch = document.getElementById('setting-card-filename');
    const cardDateSwitch = document.getElementById('setting-card-date');
    const cardStatusSwitch = document.getElementById('setting-card-status');

    if (fitToLabelsSwitch) {
        fitToLabelsSwitch.checked = isFitToLabelsEnabled;
        fitToLabelsSwitch.addEventListener('change', event => {
            setIsFitToLabelsEnabled(event.target.checked);
            if (isFitToLabelsEnabled) fitToLabels();
            else resetView();
        });
    }

    if (advanceAfterSaveSwitch) {
        advanceAfterSaveSwitch.checked = isAdvanceAfterSaveEnabled;
        advanceAfterSaveSwitch.addEventListener('change', event => {
            setIsAdvanceAfterSaveEnabled(event.target.checked);
        });
    }

    if (autoSaveSwitch) {
        autoSaveSwitch.checked = isAutoSaveEnabled;
        autoSaveSwitch.addEventListener('change', e => {
            setIsAutoSaveEnabled(e.target.checked);
        });
    }

    if (cardDotsSwitch) {
        cardDotsSwitch.checked = isCardShowDots;
        cardDotsSwitch.addEventListener('change', e => {
            setIsCardShowDots(e.target.checked);
            applyCardDisplaySettings();
        });
    }

    if (cardFilenameSwitch) {
        cardFilenameSwitch.checked = isCardShowFilename;
        cardFilenameSwitch.addEventListener('change', e => {
            setIsCardShowFilename(e.target.checked);
            applyCardDisplaySettings();
        });
    }

    if (cardDateSwitch) {
        cardDateSwitch.checked = isCardShowDate;
        cardDateSwitch.addEventListener('change', e => {
            setIsCardShowDate(e.target.checked);
            applyCardDisplaySettings();
        });
    }

    if (cardStatusSwitch) {
        cardStatusSwitch.checked = isCardShowStatus;
        cardStatusSwitch.addEventListener('change', e => {
            setIsCardShowStatus(e.target.checked);
            applyCardDisplaySettings();
        });
    }

    // Apply card settings initially on load
    applyCardDisplaySettings();

    const tabButtons = Array.from(document.querySelectorAll('.style-tab-btn'));
    const tabPanels = Array.from(document.querySelectorAll('.style-tab-panel'));

    function setError(message = '') {
        if (!errorBox) return;
        errorBox.textContent = message;
        errorBox.style.display = message ? 'block' : 'none';
    }

    function updateJsonEditor() {
        if (jsonEditor) jsonEditor.value = JSON.stringify(draftConfig, null, 2);
    }

    function updateColorFieldPreview(input) {
        const field = input.closest('.style-color-field');
        if (!field) return;
        field.style.setProperty('--style-color-preview', input.value);
    }

    function updatePreview(row, cls) {
        const style = getResolvedClassStyle(cls);
        const preview = row.querySelector('.style-preview-outline');
        if (!preview) return;
        preview.style.border = `${style.strokeWidth}px solid ${style.strokeColor}`;
        preview.style.background = style.renderMode === 'outline'
            ? 'transparent'
            : hexToRgba(style.fillColor, style.fillOpacity);
        if (style.renderMode === 'fill') {
            preview.style.borderColor = 'transparent';
        }
    }

    function refreshResolvedStyles() {
        setCurrentStyleConfig(draftConfig, classes);
        if (classRows) {
            classRows.querySelectorAll('tr').forEach(row => updatePreview(row, row.dataset.className));
        }
    }

    function syncGlobalInputs() {
        if (defaultRenderMode) defaultRenderMode.value = draftConfig.defaults.render_mode;
        if (defaultStrokeWidth) defaultStrokeWidth.value = draftConfig.defaults.stroke_width;
        if (defaultFillOpacity) defaultFillOpacity.value = draftConfig.defaults.fill_opacity;
        if (selectedStrokeWidth) selectedStrokeWidth.value = draftConfig.selected.stroke_width;
        if (selectedStrokeColor) selectedStrokeColor.value = draftConfig.selected.stroke_color;
        if (preannotationFillOpacity) preannotationFillOpacity.value = draftConfig.preannotation.fill_opacity;
    }

    function attachRowHandlers(row, cls) {
        row.querySelector('[data-field="stroke_color"]').addEventListener('input', e => {
            draftConfig.classes[cls] = draftConfig.classes[cls] || {};
            draftConfig.classes[cls].stroke_color = e.target.value;
            updateColorFieldPreview(e.target);
            refreshResolvedStyles();
            updateJsonEditor();
        });
        row.querySelector('[data-field="fill_color"]').addEventListener('input', e => {
            draftConfig.classes[cls] = draftConfig.classes[cls] || {};
            draftConfig.classes[cls].fill_color = e.target.value;
            updateColorFieldPreview(e.target);
            refreshResolvedStyles();
            updateJsonEditor();
        });
        row.querySelector('[data-field="stroke_width"]').addEventListener('input', e => {
            draftConfig.classes[cls] = draftConfig.classes[cls] || {};
            draftConfig.classes[cls].stroke_width = Number(e.target.value);
            refreshResolvedStyles();
            updateJsonEditor();
        });
        row.querySelector('[data-field="fill_opacity"]').addEventListener('input', e => {
            draftConfig.classes[cls] = draftConfig.classes[cls] || {};
            draftConfig.classes[cls].fill_opacity = Number(e.target.value);
            refreshResolvedStyles();
            updateJsonEditor();
        });
        row.querySelector('[data-field="render_mode"]').addEventListener('change', e => {
            draftConfig.classes[cls] = draftConfig.classes[cls] || {};
            draftConfig.classes[cls].render_mode = e.target.value;
            refreshResolvedStyles();
            updateJsonEditor();
        });
    }

    function renderClassRows() {
        if (!classRows) return;
        classRows.innerHTML = '';
        classes.forEach(cls => {
            const style = getResolvedClassStyle(cls);
            const row = document.createElement('tr');
            row.dataset.className = cls;
            row.innerHTML = `
                <td>${cls}</td>
                <td>
                    <label class="style-color-field style-color-field-stroke" style="--style-color-preview: ${style.strokeColor};">
                        <span class="style-color-preview" aria-hidden="true"></span>
                        <input data-field="stroke_color" type="color" value="${style.strokeColor}">
                    </label>
                </td>
                <td>
                    <label class="style-color-field style-color-field-fill" style="--style-color-preview: ${style.fillColor};">
                        <span class="style-color-preview" aria-hidden="true"></span>
                        <input data-field="fill_color" type="color" value="${style.fillColor}">
                    </label>
                </td>
                <td><input data-field="stroke_width" type="number" min="1" max="24" step="1" value="${style.strokeWidth}"></td>
                <td><input data-field="fill_opacity" type="number" min="0" max="1" step="0.01" value="${style.fillOpacity}"></td>
                <td>
                    <select data-field="render_mode">
                        <option value="outline"${style.renderMode === 'outline' ? ' selected' : ''}>Outline</option>
                        <option value="fill"${style.renderMode === 'fill' ? ' selected' : ''}>Fill</option>
                        <option value="outline_fill"${style.renderMode === 'outline_fill' ? ' selected' : ''}>Both</option>
                    </select>
                </td>
                <td>
                    <div class="style-preview-box">
                        <div class="style-preview-outline"></div>
                    </div>
                </td>
            `;
            classRows.appendChild(row);
            attachRowHandlers(row, cls);
            updatePreview(row, cls);
        });
    }

    function renderVisualEditor() {
        refreshResolvedStyles();
        syncGlobalInputs();
        if (selectedStrokeColor) updateColorFieldPreview(selectedStrokeColor);
        renderClassRows();
        updateJsonEditor();
    }

    function parseJsonEditor() {
        try {
            draftConfig = normalizeStyleConfig(JSON.parse(jsonEditor.value), classes);
            setError('');
            renderVisualEditor();
            return true;
        } catch (error) {
            setError(`Invalid JSON: ${error.message}`);
            return false;
        }
    }

    function switchTab(tabName) {
        if (tabPanels.some(panel => panel.classList.contains('active') &&
            panel.dataset.stylePanel === tabName)) return;
        const leavingJson = tabPanels.some(panel =>
            panel.classList.contains('active') && panel.dataset.stylePanel === 'json');
        if (leavingJson && tabName !== 'json' && !parseJsonEditor()) return;
        if (tabName === 'json') updateJsonEditor();
        tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.styleTab === tabName));
        tabPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.stylePanel === tabName));
    }

    if (defaultRenderMode) {
        defaultRenderMode.addEventListener('change', e => {
            draftConfig.defaults.render_mode = e.target.value;
            renderVisualEditor();
        });
    }
    if (defaultStrokeWidth) {
        defaultStrokeWidth.addEventListener('input', e => {
            draftConfig.defaults.stroke_width = Number(e.target.value);
            renderVisualEditor();
        });
    }
    if (defaultFillOpacity) {
        defaultFillOpacity.addEventListener('input', e => {
            draftConfig.defaults.fill_opacity = Number(e.target.value);
            renderVisualEditor();
        });
    }
    if (selectedStrokeWidth) {
        selectedStrokeWidth.addEventListener('input', e => {
            draftConfig.selected.stroke_width = Number(e.target.value);
            updateJsonEditor();
        });
    }
    if (selectedStrokeColor) {
        selectedStrokeColor.addEventListener('input', e => {
            draftConfig.selected.stroke_color = e.target.value;
            updateColorFieldPreview(e.target);
            updateJsonEditor();
        });
    }
    if (preannotationFillOpacity) {
        preannotationFillOpacity.addEventListener('input', e => {
            draftConfig.preannotation.fill_opacity = Number(e.target.value);
            updateJsonEditor();
        });
    }

    tabButtons.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.styleTab)));

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            draftConfig = normalizeStyleConfig(getDefaultStyleConfig(), classes);
            renderVisualEditor();
        });
    }

    // Legacy: if the hidden openBtn still exists, keep it working for backward compat
    const openBtn = document.getElementById('annotation-style-settings-btn');
    if (openBtn) {
        openBtn.addEventListener('click', () => {
            draftConfig = normalizeStyleConfig(config.annotationStyleConfig || getCurrentStyleConfig(), classes);
            renderVisualEditor();
            setError('');
            switchTab('visual');
        });
    }

    saveBtn.addEventListener('click', async () => {
        const jsonPanelVisible = document.querySelector('.style-tab-panel.active')?.dataset.stylePanel === 'json';
        if (jsonPanelVisible && !parseJsonEditor()) return;

        saveBtn.disabled = true;
        setError('');
        try {
            const response = await fetch(`/annotation/style_config/${encodeURIComponent(config.projectName)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ styleConfig: draftConfig }),
            });
            const payload = await response.json();
            if (!response.ok || !payload.success) {
                throw new Error(payload.detail || payload.error || 'Failed to save style settings');
            }
            config.annotationStyleConfig = structuredCloneSafe(draftConfig);
            setCurrentStyleConfig(draftConfig, classes);
            drawImage();
            // Show brief success feedback in the save button
            saveBtn.textContent = '✓ Saved';
            setTimeout(() => { saveBtn.textContent = 'Save Settings'; }, 2000);
        } catch (error) {
            setError(error.message);
        } finally {
            saveBtn.disabled = false;
        }
    });

    // Initialize the visual editor immediately since settings are always visible in the inline panel
    renderVisualEditor();
}
