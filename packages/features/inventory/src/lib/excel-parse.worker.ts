import { parseExcelBuffer } from './excel-io';

self.onmessage = async (event: MessageEvent<{ buffer: ArrayBuffer; fileName?: string }>) => {
  try {
    const data = await parseExcelBuffer(event.data.buffer, event.data.fileName);
    self.postMessage({ ok: true, data });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Không thể đọc file Excel.',
    });
  }
};

