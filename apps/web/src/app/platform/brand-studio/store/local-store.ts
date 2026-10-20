import {
  DEFAULT_PALETTE,
  DEFAULT_RULES,
  PRESET_IDS,
  createPresetDocuments,
  newId,
  normalizeLibrary,
  normalizePalette,
  normalizeRules,
  type BrandPalette,
  type BrandRules,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';

export const STORAGE_KEYS = {
  docs: 'svndts-brand-icons-v2',
  legacyDocs: 'svndts-brand-studio-icons',
  palette: 'svndts-brand-palette-v1',
  rules: 'svndts-brand-rules-v1',
} as const;

export interface LocalSnapshot {
  readonly ready: boolean;
  readonly docs: readonly IconDocument[];
  readonly palette: BrandPalette;
  readonly rules: BrandRules;
  readonly error: string | null;
}

const SERVER_SNAPSHOT: LocalSnapshot = {
  ready: false,
  docs: [],
  palette: DEFAULT_PALETTE,
  rules: DEFAULT_RULES,
  error: null,
};

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): string | null {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return null;
  } catch {
    return 'Không lưu được vào trình duyệt (bộ nhớ đầy hoặc bị chặn).';
  }
}

/** Icon mẫu mới thêm vào mã nguồn luôn xuất hiện, kể cả khi người dùng đã lưu thư viện từ trước. */
function withPresets(docs: readonly IconDocument[]): IconDocument[] {
  const present = new Set(docs.map((doc) => doc.id));
  return [...docs, ...createPresetDocuments().filter((preset) => !present.has(preset.id))];
}

function loadDocs(): IconDocument[] {
  for (const key of [STORAGE_KEYS.docs, STORAGE_KEYS.legacyDocs]) {
    const raw = readJson(key);
    if (raw === null) continue;
    try {
      const { docs } = normalizeLibrary(raw);
      if (docs.length > 0) return withPresets(docs);
    } catch {
      // Dữ liệu hỏng: thử nguồn kế tiếp
    }
  }
  return createPresetDocuments();
}

let snapshot: LocalSnapshot = SERVER_SNAPSHOT;
let initialized = false;
const listeners = new Set<() => void>();

function emit(next: Partial<LocalSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function ensureInitialized() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  snapshot = {
    ready: true,
    docs: loadDocs(),
    palette: normalizePalette(readJson(STORAGE_KEYS.palette)),
    rules: normalizeRules(readJson(STORAGE_KEYS.rules)),
    error: null,
  };
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEYS.docs) emit({ docs: loadDocs() });
    if (event.key === STORAGE_KEYS.palette) emit({ palette: normalizePalette(readJson(STORAGE_KEYS.palette)) });
    if (event.key === STORAGE_KEYS.rules) emit({ rules: normalizeRules(readJson(STORAGE_KEYS.rules)) });
  });
}

export const localStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): LocalSnapshot {
    ensureInitialized();
    return snapshot;
  },
  getServerSnapshot(): LocalSnapshot {
    return SERVER_SNAPSHOT;
  },

  setDocs(docs: readonly IconDocument[]) {
    const error = writeJson(STORAGE_KEYS.docs, docs);
    emit({ docs, error });
  },
  setPalette(palette: BrandPalette) {
    const error = writeJson(STORAGE_KEYS.palette, palette);
    emit({ palette, error });
  },
  setRules(rules: BrandRules) {
    const error = writeJson(STORAGE_KEYS.rules, rules);
    emit({ rules, error });
  },
  resetSettings() {
    try {
      window.localStorage.removeItem(STORAGE_KEYS.palette);
      window.localStorage.removeItem(STORAGE_KEYS.rules);
    } catch {
      // Bỏ qua nếu bị chặn
    }
    emit({ palette: DEFAULT_PALETTE, rules: DEFAULT_RULES, error: null });
  },

  /** Chỉ dùng cho kiểm thử: nạp lại từ localStorage. */
  reloadForTest() {
    initialized = false;
    snapshot = SERVER_SNAPSHOT;
    ensureInitialized();
    emit({});
  },
};

export function freshId(): string {
  return newId('icon');
}

export function isPresetId(id: string): boolean {
  return PRESET_IDS.has(id);
}
