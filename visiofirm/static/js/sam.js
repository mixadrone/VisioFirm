import { currentImage, currentImageKey, currentImageIndex, thumbnailImages, annotations, selectedClass, setupType, updateTagHighlights, setSelectedAnnotation, setWorker, worker } from './globals.js';
import { drawImage } from './annotationDrawing.js';
import { pushToUndoStack } from './annotationCore.js';

const modelStorageKey = 'visiofirm_magic_model';
const supportedModels = new Set(['slimsam', 'sam2.1_t', 'sam2.1_s']);
const modelNames = { slimsam: 'SlimSAM', 'sam2.1_t': 'SAM 2.1 Tiny', 'sam2.1_s': 'SAM 2.1 Small' };
let selectedMagicModel = 'slimsam';
let segmenting = false;
let slimReadyPromise = null;

function getSelectedModel() {
  return selectedMagicModel;
}

function showStatus(message) {
  const status = document.getElementById('magic-model-status');
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
}

export function initializeSegmentor() {
  const picker = document.getElementById('magic-model-picker');
  const trigger = document.getElementById('magic-model-trigger');
  const menu = document.getElementById('magic-model-menu');
  if (!picker || !trigger || !menu) return;

  const options = Array.from(menu.querySelectorAll('[data-model]'));
  const closeMenu = () => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };
  const syncSelection = () => {
    trigger.title = `Magic model: ${modelNames[selectedMagicModel]}`;
    trigger.setAttribute('aria-label', `Models, current: ${modelNames[selectedMagicModel]}`);
    options.forEach(option => option.setAttribute('aria-checked', String(option.dataset.model === selectedMagicModel)));
  };
  const warmSlimSam = () => {
    if (selectedMagicModel === 'slimsam') {
      ensureSlimSamReady().catch(error => {
        if (getSelectedModel() === 'slimsam') showStatus(error.message);
      });
    }
  };

  const saved = localStorage.getItem(modelStorageKey);
  selectedMagicModel = supportedModels.has(saved) ? saved : 'slimsam';
  syncSelection();
  warmSlimSam();

  trigger.addEventListener('click', () => {
    if (menu.hidden) {
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      options.find(option => option.dataset.model === selectedMagicModel)?.focus();
    } else {
      closeMenu();
    }
  });
  options.forEach(option => option.addEventListener('click', () => {
    selectedMagicModel = option.dataset.model;
    localStorage.setItem(modelStorageKey, selectedMagicModel);
    syncSelection();
    showStatus('');
    closeMenu();
    trigger.focus();
    warmSlimSam();
  }));
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      trigger.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const index = options.indexOf(document.activeElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      options[(index + step + options.length) % options.length].focus();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!picker.contains(event.target)) closeMenu();
  });
}

function ensureSlimSamReady() {
  if (slimReadyPromise) return slimReadyPromise;
  setWorker(new Worker(new URL('./samWorker.js', import.meta.url), { type: 'module' }));
  slimReadyPromise = new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', handler);
      worker.removeEventListener('error', fail);
    };
    const fail = (event) => {
      cleanup();
      reject(new Error(event.message || 'SlimSAM failed to load'));
    };
    const handler = (event) => {
      const { status, message } = event.data;
      if (status === 'ready' || status === 'error') {
        cleanup();
        if (status === 'ready') resolve();
        else reject(new Error(message));
      }
    };
    worker.addEventListener('message', handler);
    worker.addEventListener('error', fail);
    worker.postMessage({ type: 'init' });
  }).catch((error) => {
    worker?.terminate();
    setWorker(null);
    slimReadyPromise = null;
    throw error;
  });
  return slimReadyPromise;
}

async function segmentWithSlimSam(point, label, image, imageKey) {
  await ensureSlimSamReady();

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(image, 0, 0);
  const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', handler);
      worker.removeEventListener('error', fail);
    };
    const fail = (event) => {
      cleanup();
      reject(new Error(event.message || 'SlimSAM failed'));
    };
    const handler = (event) => {
      const { status, result, message } = event.data;
      if (!['complete', 'no-mask', 'error'].includes(status)) return;
      cleanup();
      if (status === 'error') reject(new Error(message || 'SlimSAM failed'));
      else resolve(status === 'complete' ? result : null);
    };
    worker.addEventListener('message', handler);
    worker.addEventListener('error', fail);
    worker.postMessage({
      type: 'segment',
      point,
      imageBuffer: imageData.data.buffer,
      width: tempCanvas.width,
      height: tempCanvas.height,
      imageId: image.src || imageKey,
      setupType,
      selectedClass: label,
    }, [imageData.data.buffer]);
  });
}

async function segmentWithSam21(point, model) {
  const imageId = Number(thumbnailImages[currentImageIndex]?.closest('[data-image-id]')?.dataset.imageId);
  if (!Number.isInteger(imageId) || imageId <= 0) throw new Error('Image ID is unavailable');
  const config = JSON.parse(document.getElementById('app-config').textContent);
  const response = await fetch('/annotation/magic_segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_name: config.projectName,
      image_id: imageId,
      model,
      x: point.x,
      y: point.y,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || 'SAM 2.1 failed');
  return data.annotation;
}

export async function segmentArea(point) {
  if (segmenting || !currentImage || !currentImageKey) return null;
  segmenting = true;
  const imageKey = currentImageKey;
  const image = currentImage;
  const model = getSelectedModel();
  const label = selectedClass;
  const trigger = document.getElementById('magic-model-trigger');
  if (trigger) trigger.disabled = true;
  showStatus('Processing...');

  try {
    const result = model === 'slimsam'
      ? await segmentWithSlimSam(point, label, image, imageKey)
      : await segmentWithSam21(point, model);
    if (currentImageKey !== imageKey || currentImage !== image) {
      showStatus('');
      return null;
    }
    if (!result) {
      showStatus('No object found');
      return null;
    }
    pushToUndoStack();
    annotations.push({ ...result, label });
    setSelectedAnnotation(null);
    updateTagHighlights();
    drawImage();
    showStatus('');
    return result;
  } catch (error) {
    console.error('Magic annotation failed:', error);
    showStatus(currentImageKey === imageKey && currentImage === image
      ? (error.message || 'Magic annotation failed') : '');
    return null;
  } finally {
    segmenting = false;
    if (trigger) trigger.disabled = false;
  }
}
