import { ACCEPTED_INPUT_LABEL, FORMAT_BY_EXT, OUTPUT_FORMATS, isOutputFormat } from './formats.js';
import { buildZip } from './zip.js';

const FORMAT_KEY = 'toazw3-output';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const queueWrap = document.getElementById('queue-wrap');
const queueEl = document.getElementById('queue');
const queueCount = document.getElementById('queue-count');
const convertBtn = document.getElementById('convert-btn');
const clearBtn = document.getElementById('clear-btn');
const addMoreBtn = document.getElementById('add-more-btn');
const batchBar = document.getElementById('batch-bar');
const downloadZipBtn = document.getElementById('download-zip-btn');
const batchNote = document.getElementById('batch-note');
const engine = document.getElementById('engine');
const engineStatus = document.getElementById('engine-status');
const formatPicker = document.getElementById('format-picker');

const jobs = [];
let nextId = 1;
let converting = false;
let workerReady = false;
let outputFormat = loadOutputFormat();

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

worker.addEventListener('message', onWorkerMessage);
worker.addEventListener('error', (event) => {
  setEngine('error', 'Converter failed to load. Serve this folder over HTTP, not as a file:// page.');
  console.error(event);
});

worker.postMessage({ type: 'init' });

function setEngine(state, text) {
  engine.classList.remove('ready', 'error');
  if (state) engine.classList.add(state);
  engineStatus.textContent = text;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionOf(name) {
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function baseName(name) {
  return name.replace(/\.[^/.]+$/, '');
}

function loadOutputFormat() {
  try {
    const saved = sessionStorage.getItem(FORMAT_KEY);
    if (isOutputFormat(saved)) return saved;
  } catch {
    /* Private browsing can block sessionStorage. */
  }
  return 'azw3';
}

function saveOutputFormat(format) {
  try {
    sessionStorage.setItem(FORMAT_KEY, format);
  } catch {
    /* Ignore storage failures. */
  }
}

function outputNameFor(filename, format) {
  return `${baseName(filename)}.${OUTPUT_FORMATS[format].extension}`;
}

function uniqueOutputName(preferred, used) {
  const ext = extensionOf(preferred) || 'azw3';
  const stem = baseName(preferred);
  let name = preferred;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    name = `${stem}-${n}.${ext}`;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

function selectedFormat() {
  const picked = formatPicker && formatPicker.querySelector('input[name="output-format"]:checked');
  return picked && isOutputFormat(picked.value) ? picked.value : outputFormat;
}

function applyOutputFormat(format) {
  outputFormat = format;
  saveOutputFormat(format);
  for (const job of jobs) {
    if (job.status === 'done' || job.status === 'converting') continue;
    job.to = format;
    job.outputName = outputNameFor(job.file.name, format);
  }
  render();
}

function addFiles(fileList) {
  const incoming = Array.from(fileList || []);
  let skipped = 0;

  for (const file of incoming) {
    const from = FORMAT_BY_EXT[extensionOf(file.name)];
    if (!from) {
      skipped += 1;
      continue;
    }
    jobs.push({
      id: nextId++,
      file,
      from,
      status: 'queued',
      error: '',
      info: null,
      to: outputFormat,
      outputName: outputNameFor(file.name, outputFormat),
      outputBytes: null,
    });
  }

  if (skipped && incoming.length) {
    window.alert(
      `${skipped} file${skipped === 1 ? ' was' : 's were'} skipped. Use ${ACCEPTED_INPUT_LABEL}.`,
    );
  }

  render();
}

function pendingJobs() {
  return jobs.filter((job) => job.status === 'queued' || job.status === 'error');
}

function doneJobs() {
  return jobs.filter((job) => job.status === 'done' && job.outputBytes);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function render() {
  queueWrap.hidden = jobs.length === 0;
  queueCount.textContent = String(jobs.length);
  convertBtn.disabled = !workerReady || converting || pendingJobs().length === 0;
  const format = OUTPUT_FORMATS[outputFormat];
  convertBtn.textContent = converting ? 'Converting…' : `Convert to ${format.label}`;
  clearBtn.disabled = converting;
  if (formatPicker) {
    for (const input of formatPicker.querySelectorAll('input')) input.disabled = converting;
  }

  const done = doneJobs();
  batchBar.hidden = done.length === 0;
  batchNote.textContent = done.length
    ? `${done.length} file${done.length === 1 ? '' : 's'} ready`
    : '';

  queueEl.replaceChildren(
    ...jobs.map((job) => {
      const li = document.createElement('li');
      li.className = 'job';
      li.dataset.id = String(job.id);

      const title = document.createElement('div');
      title.className = 'job-name';
      title.textContent = job.file.name;

      const meta = document.createElement('div');
      meta.className = 'job-meta';
      const bits = [`${job.from.toUpperCase()} → ${job.to.toUpperCase()}`, formatSize(job.file.size)];
      if (job.info && job.info.title) bits.push(job.info.title);
      if (job.info && Array.isArray(job.info.authors) && job.info.authors.length) {
        bits.push(job.info.authors.join(', '));
      }
      if (job.info && job.info.pages) {
        bits.push(`${job.info.pages} page${job.info.pages === 1 ? '' : 's'}`);
      }
      meta.textContent = bits.join(' · ');

      const side = document.createElement('div');
      side.className = 'job-side';

      const badge = document.createElement('span');
      badge.className = `badge ${job.status}`;
      badge.textContent = job.status;
      side.append(badge);

      if (job.status === 'done') {
        const dl = document.createElement('button');
        dl.type = 'button';
        dl.className = 'btn small';
        dl.textContent = 'Download';
        dl.addEventListener('click', () => {
          downloadBlob(
            new Blob([job.outputBytes], { type: OUTPUT_FORMATS[job.to].mime }),
            job.outputName,
          );
        });
        side.append(dl);
      } else if (!converting) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn ghost small';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
          const index = jobs.findIndex((item) => item.id === job.id);
          if (index >= 0) jobs.splice(index, 1);
          render();
        });
        side.append(remove);
      }

      li.append(title, side, meta);
      if (job.error) {
        const err = document.createElement('div');
        err.className = 'job-error';
        err.textContent = job.error;
        li.append(err);
      }
      return li;
    }),
  );
}

async function convertNext() {
  const job = jobs.find((item) => item.status === 'queued');
  if (!job) {
    converting = false;
    const done = doneJobs().length;
    const failed = jobs.filter((item) => item.status === 'error').length;
    setEngine(
      'ready',
      failed
        ? `Finished with ${done} converted, ${failed} failed.`
        : `Finished ${done} file${done === 1 ? '' : 's'}.`,
    );
    render();
    return;
  }

  job.status = 'converting';
  job.error = '';
  setEngine('ready', `Converting ${job.file.name}…`);
  render();

  try {
    const bytes = await job.file.arrayBuffer();
    worker.postMessage(
      { type: 'convert', id: job.id, from: job.from, to: job.to, name: job.file.name, bytes },
      [bytes],
    );
  } catch (err) {
    job.status = 'error';
    job.error = err && err.message ? err.message : String(err);
    convertNext();
  }
}

function onWorkerMessage(event) {
  const msg = event.data || {};
  if (msg.type === 'ready') {
    workerReady = true;
    setEngine('ready', 'Converter ready. Files stay in this browser.');
    render();
    return;
  }

  if (msg.type === 'progress') {
    const active = jobs.find((item) => item.id === msg.id);
    if (active && active.status === 'converting' && msg.message) setEngine('ready', msg.message);
    return;
  }

  const job = jobs.find((item) => item.id === msg.id);
  if (!job) return;

  if (msg.type === 'done') {
    job.status = 'done';
    job.info = msg.info;
    job.outputBytes = new Uint8Array(msg.bytes);
    convertNext();
    return;
  }

  if (msg.type === 'error') {
    job.status = 'error';
    job.error = msg.message || 'Conversion failed.';
    convertNext();
  }
}

function startConversion() {
  if (!workerReady || converting) return;
  for (const job of jobs) {
    if (job.status === 'error') {
      job.status = 'queued';
      job.error = '';
    }
  }
  if (pendingJobs().length === 0) return;
  converting = true;
  render();
  convertNext();
}

function downloadZip() {
  const done = doneJobs();
  if (!done.length) return;
  const used = new Set();
  const files = done.map((job) => ({
    name: uniqueOutputName(job.outputName, used),
    data: job.outputBytes,
  }));
  const blob = buildZip(files);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `toazw3-${stamp}.zip`);
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});

['dragenter', 'dragover'].forEach((type) => {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((type) => {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
  });
});

dropzone.addEventListener('drop', (event) => {
  addFiles(event.dataTransfer.files);
});

fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
    addFiles(event.dataTransfer.files);
  }
});

if (formatPicker) {
  const initial = formatPicker.querySelector(`input[value="${outputFormat}"]`);
  if (initial) initial.checked = true;
  formatPicker.addEventListener('change', () => {
    if (converting) return;
    applyOutputFormat(selectedFormat());
  });
}

convertBtn.addEventListener('click', startConversion);
addMoreBtn.addEventListener('click', () => fileInput.click());
clearBtn.addEventListener('click', () => {
  if (converting) return;
  jobs.splice(0, jobs.length);
  render();
});
downloadZipBtn.addEventListener('click', downloadZip);

render();
