/**
 * Chạy `worker` cho từng phần tử với tối đa `limit` việc cùng lúc. Việc nào ném lỗi thì lỗi đó phải được `worker`
 * tự bắt: hàm này không nuốt lỗi và sẽ dừng cấp việc mới khi một việc ném lỗi.
 */
export async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(lanes);
}
