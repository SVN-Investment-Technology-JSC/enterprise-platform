import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/** Xoá thư mục con của `root` không được ghi trong `maxAgeMs` (việc bị bỏ dở do tiến trình sập). Trả về số thư mục đã xoá. */
export async function cleanStaleWorkDirs(root: string, maxAgeMs: number, now: number = Date.now()): Promise<number> {
  await mkdir(root, { recursive: true });
  let removed = 0;
  for (const name of await readdir(root)) {
    const target = path.join(root, name);
    try {
      const info = await stat(target);
      if (now - info.mtimeMs <= maxAgeMs) continue;
      await rm(target, { recursive: true, force: true });
      removed += 1;
    } catch {
      /* đã bị xoá hoặc không đọc được: bỏ qua */
    }
  }
  return removed;
}
