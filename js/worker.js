import { preloadArchive } from './archive.js';
import { convertBook, initConverter } from './convert.js';

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === 'init') {
      await initConverter();
      self.postMessage({ type: 'ready' });
      preloadArchive().catch(() => {});
      return;
    }

    if (msg.type !== 'convert') return;
    await initConverter();
    const result = await convertBook(new Uint8Array(msg.bytes), msg.from, msg.to || 'azw3', {
      name: msg.name,
      onProgress(message) {
        self.postMessage({ type: 'progress', id: msg.id, message });
      },
    });
    const output = result.bytes;
    const copy = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
    self.postMessage({ type: 'done', id: msg.id, bytes: copy, info: result.info }, [copy]);
  } catch (err) {
    self.postMessage({
      type: 'error',
      id: msg.id,
      message: err && err.message ? err.message : String(err),
    });
  }
};
