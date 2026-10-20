import { createPresetDocuments, type IconDocument } from '@enterprise-platform/shared-brand-icon';
import { makeCopy } from './doc-utils';
import { freshId, isPresetId, localStore } from './local-store';

/**
 * Thao tác trên thư viện lưu ở localStorage. Luôn đọc danh sách mới nhất trong kho thay vì danh sách lúc render,
 * để gọi liên tiếp không ghi đè nhau.
 */
const latestDocs = (): readonly IconDocument[] => localStore.getSnapshot().docs;

export const localLibraryOps = {
  async save(doc: IconDocument): Promise<IconDocument> {
    const docs = latestDocs();
    const saved: IconDocument = { ...doc, updatedAt: new Date().toISOString() };
    const exists = docs.some((item) => item.id === saved.id);
    localStore.setDocs(exists ? docs.map((item) => (item.id === saved.id ? saved : item)) : [...docs, saved]);
    return saved;
  },

  async saveMany(incoming: readonly IconDocument[]): Promise<void> {
    if (incoming.length === 0) return;
    const docs = latestDocs();
    const now = new Date().toISOString();
    const changes = new Map(incoming.map((doc) => [doc.id, { ...doc, updatedAt: now }]));
    const known = new Set(docs.map((doc) => doc.id));
    const added = [...changes.values()].filter((doc) => !known.has(doc.id));
    localStore.setDocs([...docs.map((doc) => changes.get(doc.id) ?? doc), ...added]);
  },

  async remove(id: string): Promise<void> {
    if (isPresetId(id)) return;
    localStore.setDocs(latestDocs().filter((doc) => doc.id !== id));
  },

  async removeMany(ids: readonly string[]): Promise<number> {
    const doomed = new Set(ids.filter((id) => !isPresetId(id)));
    const docs = latestDocs();
    const kept = docs.filter((doc) => !doomed.has(doc.id));
    if (kept.length === docs.length) return 0;
    localStore.setDocs(kept);
    return docs.length - kept.length;
  },

  async duplicate(id: string): Promise<IconDocument | null> {
    const docs = latestDocs();
    const source = docs.find((doc) => doc.id === id);
    if (!source) return null;
    const copy = makeCopy(source);
    localStore.setDocs([...docs, copy]);
    return copy;
  },

  async importDocs(incoming: readonly IconDocument[]): Promise<number> {
    const docs = latestDocs();
    const taken = new Set(docs.map((doc) => doc.id));
    const added: IconDocument[] = [];
    for (const doc of incoming) {
      const next = taken.has(doc.id) ? { ...doc, id: freshId() } : doc;
      taken.add(next.id);
      added.push(next);
    }
    if (added.length > 0) localStore.setDocs([...docs, ...added]);
    return added.length;
  },

  async resetPreset(id: string): Promise<void> {
    const preset = createPresetDocuments().find((item) => item.id === id);
    if (!preset) return;
    localStore.setDocs(latestDocs().map((doc) => (doc.id === id ? preset : doc)));
  },

  /** Ở chế độ cục bộ "phát hành" chỉ là đặt trạng thái của icon. */
  async publish(id: string): Promise<IconDocument | null> {
    const source = latestDocs().find((doc) => doc.id === id);
    if (!source) return null;
    return localLibraryOps.save({ ...source, status: 'published' });
  },
};
