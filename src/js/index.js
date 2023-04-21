import '@georapbox/clipboard-copy-element/dist/clipboard-copy-defined.js';
import '@georapbox/web-share-element/dist/web-share-defined.js';
import '@georapbox/files-dropzone-element/dist/files-dropzone-defined.js';
import { isWebShareSupported } from '@georapbox/web-share-element/dist/is-web-share-supported.js';
import '@georapbox/resize-observer-element/dist/resize-observer-defined.js';
import { CapturePhoto } from '@georapbox/capture-photo-element/dist/capture-photo.js';
import { getHistory, setHistory, getSettings, setSettings } from './services/storage.js';
import { toastAlert } from './toast-alert.js';

(async function () {
  const NO_BARCODE_DETECTED = 'No barcode detected';
  const ACCEPTED_MIME_TYPES = ['image/jpg', 'image/jpeg', 'image/png', 'image/apng', 'image/gif', 'image/webp', 'image/avif'];
  const capturePhotoEl = document.querySelector('capture-photo');
  const cameraResultsEl = document.getElementById('cameraResults');
  const fileResultsEl = document.getElementById('fileResults');
  const scanInstructionsEl = document.getElementById('scanInstructions');
  const scanBtn = document.getElementById('scanBtn');
  const scanMethodSelect = document.getElementById('scanMethod');
  const dropzoneEl = document.getElementById('dropzone');
  const cameraViewEl = document.getElementById('cameraView');
  const fileViewEl = document.getElementById('fileView');
  const resizeObserverEl = document.querySelector('resize-observer');
  const scanFrameEl = document.getElementById('scanFrame');
  const globalActionsEl = document.getElementById('globalActions');
  const historyBtn = document.getElementById('historyBtn');
  const historyDialog = document.getElementById('historyDialog');
  const historyList = document.getElementById('historyList');
  const deleteHistoryBtn = document.getElementById('deleteHistoryBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsDialog = document.getElementById('settingsDialog');
  const settingsForm = document.forms['settings-form'];
  const copyIconTemplate = document.getElementById('copyIconTemplate');
  const copiedIconTemplate = document.getElementById('copiedIconTemplate');
  const supportedFormatsEl = document.getElementById('supportedFormats');
  let shouldRepeatScan = true;
  let rafId;

  if (!('BarcodeDetector' in window)) {
    try {
      window.BarcodeDetector = (await import('barcode-detector')).default;
    } catch (err) {
      cameraViewEl.hidden = true;
      fileViewEl.hidden = true;
      scanMethodSelect.hidden = true;
      globalActionsEl.hidden = true;
      return toastAlert('BarcodeDetector API is not supported by your browser.', 'danger');
    }
  }

  document.querySelectorAll('clipboard-copy').forEach(el => {
    el.querySelector('button').appendChild(copyIconTemplate.content.cloneNode(true));
  });

  if (!isWebShareSupported()) {
    document.querySelectorAll('web-share').forEach(el => {
      el.hidden = true;
      el.disabled = true;
    });
  }

  const { value: history = [] } = await getHistory();

  renderHistoryList(history);

  capturePhotoEl.addEventListener('capture-photo:video-play', evt => {
    scanFrameEl.hidden = false;
    resizeScanFrame(evt.detail.video);
    scan();

    const trackSettings = capturePhotoEl.getTrackSettings();
    const trackCapabilities = capturePhotoEl.getTrackCapabilities();
    const zoomLevelEl = document.getElementById('zoomLevel');

    if (trackSettings?.zoom && trackCapabilities?.zoom) {
      const zoomControls = document.getElementById('zoomControls');
      const minZoom = trackCapabilities?.zoom?.min || 0;
      const maxZoom = trackCapabilities?.zoom?.max || 10;
      let currentZoom = trackSettings?.zoom || 1;

      zoomControls.hidden = false;
      zoomLevelEl.textContent = currentZoom;

      zoomControls.addEventListener('click', evt => {
        const zoomInBtn = evt.target.closest('[data-action="zoom-in"]');
        const zoomOutBtn = evt.target.closest('[data-action="zoom-out"]');

        if (zoomInBtn && currentZoom < maxZoom) {
          currentZoom += 0.5;
        }

        if (zoomOutBtn && currentZoom > minZoom) {
          currentZoom -= 0.5;
        }

        zoomLevelEl.textContent = currentZoom;

        capturePhotoEl.zoom = currentZoom;
      });
    }
  }, {
    once: true
  });

  capturePhotoEl.addEventListener('capture-photo:error', evt => {
    cameraViewEl.hidden = true;
    fileViewEl.hidden = false;
    scanMethodSelect.hidden = true;

    const error = evt.detail.error;

    if (error.name === 'NotFoundError') {
      return;
    }

    const errorMessage = error.name === 'NotAllowedError' ? 'Permission to use webcam was denied. Reload the page to give appropriate permissions to webcam.' : error.message;

    toastAlert(errorMessage, 'danger');
  }, {
    once: true
  });

  CapturePhoto.defineCustomElement();

  dropzoneEl.accept = ACCEPTED_MIME_TYPES.join(',');

  const capturePhotoVideoEl = capturePhotoEl.shadowRoot.querySelector('video');
  const formats = await window.BarcodeDetector.getSupportedFormats();
  const barcodeDetector = new window.BarcodeDetector({ formats });
  const { value: settings = {} } = await getSettings();

  Object.entries(settings).forEach(([key, value]) => {
    const settingInput = settingsForm.querySelector(`[name="${key}"]`);
    if (settingInput) {
      settingInput.checked = value;
    }
  });

  if (Array.isArray(formats) && formats.length > 0) {
    supportedFormatsEl.textContent = `Supported formats: ${formats.join(', ')}`;
  }

  const beep = (() => {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext || window.audioContext);

    if (!audioCtx) {
      return;
    }

    return async (duration, frequency, volume, type, callback) => {
      const { value: settings } = await getSettings();

      if (!settings?.beep) {
        return;
      }

      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      if (volume) {
        gainNode.gain.value = volume;
      }

      if (frequency) {
        oscillator.frequency.value = frequency;
      }

      if (type) {
        oscillator.type = type;
      }

      if (typeof callback === 'function') {
        oscillator.onended = callback;
      }

      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + ((duration || 500) / 1000));
    };
  })();

  function renderHistoryList(data) {
    historyList.innerHTML = '';

    if (!Array.isArray(data) || !data.length) {
      historyList.innerHTML = '<li class=>There are no saved items in history.</li>';
      deleteHistoryBtn.style.display = 'none';
    } else {
      deleteHistoryBtn.style.display = 'block';

      data.forEach(item => {
        const li = document.createElement('li');
        li.setAttribute('data-value', item);

        let historyItem;

        try {
          new URL(item);
          historyItem = document.createElement('a');
          historyItem.href = item;
          historyItem.setAttribute('target', '_blank');
          historyItem.setAttribute('rel', 'noreferrer noopener');
        } catch (err) {
          historyItem = document.createElement('span');
        }

        historyItem.textContent = item;
        historyItem.setAttribute('title', item);

        const actionsEl = document.createElement('div');
        actionsEl.className = 'history-modal__actions';

        const copyBtn = document.createElement('clipboard-copy');
        copyBtn.innerHTML = /* html */`
          <button slot="button" type="button" title="Copy to clipboard">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-clipboard" viewBox="0 0 16 16">
              <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>
              <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>
            </svg>
          </button>
        `;
        copyBtn.setAttribute('value', item);
        actionsEl.appendChild(copyBtn);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'history-modal__delete-action';
        removeBtn.title = 'Remove from history';
        removeBtn.setAttribute('data-action', 'delete');
        removeBtn.innerHTML = /* html */`
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash3-fill" viewBox="0 0 16 16">
            <path d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5Zm-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5ZM4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06Zm6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528ZM8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5Z"/>
          </svg>
        `;
        actionsEl.appendChild(removeBtn);

        li.appendChild(historyItem);
        li.appendChild(actionsEl);
        historyList.appendChild(li);
      });
    }
  }

  async function addToHistory(item) {
    const { value: settings } = await getSettings();

    if (!item || !settings?.addToHistory) {
      return;
    }

    const { value: history = [], error: getHistoryError } = await getHistory();

    if (!getHistoryError && !history.find(h => h === item)) {
      const data = [...history, item];

      const { error: setHistoryError } = await setHistory(data);

      if (!setHistoryError) {
        renderHistoryList(data);
      }
    }
  }

  async function removeFromHistory(value) {
    if (!value) {
      return;
    }

    const { value: history = [], error: getHistoryError } = await getHistory();

    if (!getHistoryError) {
      const data = history.filter(item => item !== value);

      const { error: setHistoryError } = await setHistory(data);

      if (!setHistoryError) {
        renderHistoryList(data);
      }
    }
  }

  async function emptyHistory() {
    const { error: setHistoryError } = await setHistory([]);

    if (!setHistoryError) {
      renderHistoryList([]);
    }
  }

  async function vibrate(duration = 100) {
    const { value: settings } = await getSettings();

    if (typeof window.navigator.vibrate !== 'function' || !settings?.vibrate) {
      return;
    }

    try {
      window.navigator.vibrate(duration);
    } catch {
      // Fail silently...
    }
  }

  function resizeScanFrame(videoEl) {
    if (!videoEl) {
      return;
    }

    const rect = videoEl.getBoundingClientRect();

    scanFrameEl.style.cssText = `width: ${rect.width}px; height: ${rect.height}px`;
  }

  function emptyResults(resultDialog) {
    resultDialog?.querySelector('.results__item')?.remove();
  }

  async function createResult(value, resultDialog) {
    if (!value || !resultDialog) {
      return;
    }

    emptyResults(resultDialog);

    let resultItem;

    try {
      const { value: settings } = await getSettings();

      new URL(value);
      resultItem = document.createElement('a');
      resultItem.href = value;

      if (!settings?.openWebPageSameTab) {
        resultItem.setAttribute('target', '_blank');
        resultItem.setAttribute('rel', 'noreferrer noopener');
      }

      if (settings?.openWebPage) {
        resultItem.click();
      }
    } catch (err) {
      resultItem = document.createElement('span');
    }

    resultItem.className = 'results__item';
    resultItem.classList.toggle('results__item--no-barcode', value === NO_BARCODE_DETECTED);
    resultItem.textContent = value;

    resultDialog.insertBefore(resultItem, resultDialog.querySelector('.results__actions'));

    const clipboarCopyEl = resultDialog.querySelector('clipboard-copy');
    const webShareEl = resultDialog.querySelector('web-share');
    const isValidValue = value !== NO_BARCODE_DETECTED;

    if (clipboarCopyEl) {
      clipboarCopyEl.disabled = !isValidValue;
      clipboarCopyEl.hidden = !isValidValue;
    }

    if (webShareEl && isWebShareSupported()) {
      webShareEl.disabled = !isValidValue;
      webShareEl.hidden = !isValidValue;

      if (isValidValue) {
        webShareEl.setAttribute('share-text', value);
      } else {
        webShareEl.removeAttribute('share-text');
      }
    }

    resultDialog.show();
  }

  function detectBarcode(source) {
    return new Promise((resolve, reject) => {
      barcodeDetector.detect(source).then(results => {
        if (Array.isArray(results) && results.length > 0) {
          resolve(results[0]);
        } else {
          reject({
            message: 'Could not detect barcode from provided source.'
          });
        }
      }).catch(err => {
        reject(err);
      });
    });
  }

  async function scan() {
    process.env.NODE_ENV === 'development' && console.log('Scanning...');

    scanInstructionsEl.hidden = false;

    try {
      const barcode = await detectBarcode(capturePhotoVideoEl);
      window.cancelAnimationFrame(rafId);
      emptyResults(cameraResultsEl);
      createResult(barcode.rawValue, cameraResultsEl);
      addToHistory(barcode.rawValue);
      scanInstructionsEl.hidden = true;
      scanBtn.hidden = false;
      scanFrameEl.hidden = true;
      beep(200, 860, 0.03, 'square');
      vibrate();
      return;
    } catch (err) {
      // Fail silently...
    }

    if (shouldRepeatScan) {
      rafId = window.requestAnimationFrame(() => scan());
    }
  }

  function handleFileSelect(file) {
    if (!file) {
      return;
    }

    const image = new Image();
    const reader = new FileReader();

    reader.onload = evt => {
      const data = evt.target.result;

      image.onload = async () => {
        try {
          const barcode = await detectBarcode(image);
          emptyResults(fileResultsEl);
          createResult(barcode.rawValue, fileResultsEl);
          addToHistory(barcode.rawValue);
          beep(200, 860, 0.03, 'square');
          vibrate();
        } catch (err) {
          emptyResults(fileResultsEl);
          createResult(NO_BARCODE_DETECTED, fileResultsEl);
        }
      };

      image.src = data;

      dropzoneEl.replaceChildren();

      const preview = document.createElement('div');
      preview.className = 'dropzone-preview';

      const imageWrapper = document.createElement('div');
      imageWrapper.className = 'dropzone-preview__image-wrapper';

      const fileNameWrapper = document.createElement('div');
      fileNameWrapper.className = 'dropzone-preview__file-name';
      fileNameWrapper.textContent = file.name;

      imageWrapper.appendChild(image);
      preview.appendChild(imageWrapper);
      preview.appendChild(fileNameWrapper);
      dropzoneEl.prepend(preview);
    };

    reader.readAsDataURL(file);
  }

  scanBtn.addEventListener('click', () => {
    scanBtn.hidden = true;
    scanFrameEl.hidden = false;
    emptyResults(cameraResultsEl);
    cameraResultsEl.close();
    scan();
  });

  scanMethodSelect.addEventListener('change', evt => {
    const value = evt.target.value;

    [cameraViewEl, fileViewEl].forEach(el => {
      el.hidden = el.id !== value;
    });

    if (value === 'cameraView') {
      shouldRepeatScan = true;

      if (
        !cameraViewEl.hidden // Assumes that element is hidden because of error.
        && !capturePhotoEl.loading
        && !cameraResultsEl.querySelector('.results__item')
      ) {
        scan();
      }
    }

    if (value === 'fileView') {
      shouldRepeatScan = false;
    }
  });

  dropzoneEl.addEventListener('files-dropzone-drop', evt => {
    handleFileSelect(evt.detail.acceptedFiles[0]);
  });

  resizeObserverEl.addEventListener('resize-observer:resize', () => {
    resizeScanFrame(capturePhotoEl.shadowRoot.querySelector('video'));
  });

  settingsBtn.addEventListener('click', () => {
    settingsDialog.showModal();
  });

  historyBtn.addEventListener('click', () => {
    historyDialog.showModal();
  });

  historyDialog.addEventListener('click', evt => {
    if (evt.target === evt.currentTarget) {
      historyDialog.close();
    }
  });

  settingsDialog.addEventListener('click', evt => {
    if (evt.target === evt.currentTarget) {
      settingsDialog.close();
    }
  });

  settingsForm.addEventListener('change', evt => {
    const settings = {};
    const checkboxes = evt.currentTarget.querySelectorAll('input[type="checkbox"]');

    checkboxes.forEach(item => settings[item.name] = item.checked);
    setSettings(settings);
  });

  historyList.addEventListener('click', evt => {
    const target = evt.target;

    if (target.closest('[data-action="delete"]')) {
      if (window.confirm('Delete item from history?')) {
        removeFromHistory(target.closest('li').dataset.value);
      }
    }
  });

  deleteHistoryBtn.addEventListener('click', () => {
    if (window.confirm('Are you sure you want to empty history?')) {
      emptyHistory();
    }
  });

  document.addEventListener('clipboard-copy:success', evt => {
    const copyBtn = evt.target.querySelector('button[slot="button"]');
    const historyDialog = evt.target.closest('#historyDialog');
    const copiedTemplate = copiedIconTemplate.content.cloneNode(true);
    const copyTemplate = copyIconTemplate.content.cloneNode(true);
    const copiedTextEl = copiedTemplate.querySelector('span');
    const copyTextEl = copyTemplate.querySelector('span');

    if (historyDialog) {
      copiedTextEl.hidden = true;
      copyTextEl.hidden = true;
    } else {
      copiedTextEl.hidden = false;
      copyTextEl.hidden = false;
    }

    if (copyBtn) {
      copyBtn.replaceChildren();
      copyBtn.appendChild(copiedTemplate);

      setTimeout(() => {
        copyBtn.replaceChildren();
        copyBtn.appendChild(copyTemplate);
      }, 1500);
    }
  });
}());
