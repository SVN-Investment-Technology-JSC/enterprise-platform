import {
  DEFAULT_PALETTE,
  DEFAULT_RULES,
  normalizeDocument,
  normalizePalette,
  normalizeRules,
  type BrandIconDetail,
  type BrandIconSummary,
  type BrandPalette,
  type BrandRules,
  type BrandStandardsResponse,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';
import * as api from './brand-api';
import { runPool } from './concurrency';
import { presetDocs } from './doc-utils';
import type { StoreMode } from './types';

/** Số yêu cầu tải spec chạy cùng lúc. */
export const SPEC_CONCURRENCY = 6;
/** Thời gian chờ tối đa của lần thử kết nối đầu tiên; quá hạn coi như máy chủ chưa dùng được. */
export const PROBE_TIMEOUT_MS = 8000;
/** Sửa bảng màu liên tục (kéo bộ chọn màu) chỉ gửi một lần sau khi ngừng sửa chừng này. */
export const STANDARDS_DEBOUNCE_MS = 700;
/** Bản sao bảng màu và quy chuẩn lần cuối đọc được từ máy chủ, để lần mở sau không nháy. Tách khỏi khoá của chế độ cục bộ. */
export const STANDARDS_CACHE_KEY = 'svndts-brand-standards-cache-v1';

export interface StandardsState {
  /** Phiên bản trên máy chủ (0 là chưa lưu lần nào). */
  readonly version: number;
  readonly palette: BrandPalette;
  readonly rules: BrandRules;
}

interface Core {
  readonly mode: StoreMode;
  /** Lý do đang ở chế độ cục bộ. */
  readonly localReason: string | null;
  /** Đang kết nối hoặc nạp từ máy chủ. */
  readonly loading: boolean;
  /** Đã nạp xong danh sách và spec của mọi icon (chỉ có nghĩa ở chế độ `server`). */
  readonly ready: boolean;
  readonly error: string | null;
  readonly standards: StandardsState | null;
  readonly standardsSaving: boolean;
  readonly standardsError: string | null;
}

export interface RemoteSnapshot extends Core {
  /** Tóm tắt mọi icon trên máy chủ, kể cả icon đã lưu trữ. */
  readonly summaries: ReadonlyMap<string, BrandIconSummary>;
  /** Icon hiển thị trong thư viện: bản trên máy chủ (đã áp thay đổi chờ ghi) cộng icon mẫu chưa có trên máy chủ. */
  readonly docs: readonly IconDocument[];
  readonly docsById: ReadonlyMap<string, IconDocument>;
}

const INITIAL_CORE: Core = {
  mode: 'checking',
  localReason: null,
  loading: false,
  ready: false,
  error: null,
  standards: null,
  standardsSaving: false,
  standardsError: null,
};

const SERVER_SNAPSHOT: RemoteSnapshot = {
  ...INITIAL_CORE,
  summaries: new Map(),
  docs: [],
  docsById: new Map(),
};

let core: Core = INITIAL_CORE;
let summaries: ReadonlyMap<string, BrandIconSummary> = new Map();
/** Spec đã nạp, bất biến theo (mã icon, phiên bản) nên không bao giờ nạp lại. */
const specs = new Map<string, Map<number, IconDocument>>();
const specFlights = new Map<string, Promise<void>>();
/** Thay đổi người dùng vừa làm, chưa có phản hồi của máy chủ: null là đang xoá. Máy chủ trả lời thì bỏ đi hoặc hoàn lại. */
const overlay = new Map<string, IconDocument | null>();
const derived = new Map<string, { readonly key: string; readonly spec: IconDocument; readonly doc: IconDocument }>();
/** Số thứ tự lần ghi gần nhất của từng icon; để lần nạp lại danh sách không đè bản vừa ghi sau khi nó bắt đầu. */
const touched = new Map<string, number>();
let commitSeq = 0;

let snapshot: RemoteSnapshot = SERVER_SNAPSHOT;
let initialized = false;
let probing: Promise<void> | null = null;
const listeners = new Set<() => void>();

let standardsDirty = false;
let standardsTimer: ReturnType<typeof setTimeout> | null = null;
let standardsFlight: Promise<void> | null = null;

const specKey = (id: string, version: number) => `${id}@${version}`;

function exactSpec(id: string, version: number): IconDocument | undefined {
  return specs.get(id)?.get(version);
}

/** Spec của đúng phiên bản; chưa nạp xong thì dùng tạm bản cũ hơn gần nhất để icon không biến mất lúc cập nhật. */
function bestSpec(id: string, version: number): IconDocument | undefined {
  const byVersion = specs.get(id);
  if (!byVersion) return undefined;
  const exact = byVersion.get(version);
  if (exact) return exact;
  let best: IconDocument | undefined;
  let bestVersion = -1;
  for (const [candidate, doc] of byVersion) {
    if (candidate < version && candidate > bestVersion) {
      best = doc;
      bestVersion = candidate;
    }
  }
  return best;
}

function serverDoc(summary: BrandIconSummary, spec: IconDocument): IconDocument {
  const key = `${summary.currentVersion}|${summary.status}|${summary.createdAt}|${summary.updatedAt}`;
  const hit = derived.get(summary.id);
  if (hit && hit.key === key && hit.spec === spec) return hit.doc;
  const doc: IconDocument = {
    ...spec,
    status: summary.status === 'published' ? 'published' : 'draft',
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
  derived.set(summary.id, { key, spec, doc });
  return doc;
}

function buildSnapshot(): RemoteSnapshot {
  // Thư viện máy chủ chỉ có nghĩa ở chế độ máy chủ; chế độ khác dùng localStorage nên không hiện icon mẫu ở đây.
  if (core.mode !== 'server') return { ...core, summaries, docs: [], docsById: new Map() };
  const docs: IconDocument[] = [];
  const seen = new Set<string>();
  for (const summary of summaries.values()) {
    seen.add(summary.id);
    const pending = overlay.get(summary.id);
    if (pending === null) continue;
    if (pending) {
      docs.push(pending);
      continue;
    }
    if (summary.status === 'archived') continue;
    const spec = bestSpec(summary.id, summary.currentVersion);
    if (spec) docs.push(serverDoc(summary, spec));
  }
  for (const [id, pending] of overlay) {
    if (pending && !seen.has(id)) {
      docs.push(pending);
      seen.add(id);
    }
  }
  for (const preset of presetDocs()) {
    if (!seen.has(preset.id)) docs.push(preset);
  }
  return { ...core, summaries, docs, docsById: new Map(docs.map((doc) => [doc.id, doc])) };
}

function emit() {
  snapshot = buildSnapshot();
  for (const listener of listeners) listener();
}

/* ------------------------------------------------------------ bản sao bảng màu */

function toStandards(response: BrandStandardsResponse): StandardsState {
  return { version: response.version, palette: normalizePalette(response.palette), rules: normalizeRules(response.rules) };
}

function readStandardsCache(): StandardsState | null {
  try {
    const raw = window.localStorage.getItem(STANDARDS_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 0) return null;
    return { version: data.version, palette: normalizePalette(data.palette), rules: normalizeRules(data.rules) };
  } catch {
    return null;
  }
}

function writeStandardsCache(standards: StandardsState | null) {
  if (!standards) return;
  try {
    window.localStorage.setItem(STANDARDS_CACHE_KEY, JSON.stringify(standards));
  } catch {
    // Bộ nhớ trình duyệt đầy hoặc bị chặn: chỉ mất bản sao, máy chủ vẫn là nguồn sự thật.
  }
}

/* ------------------------------------------------------------ danh sách và spec */

function pickSummary(detail: BrandIconDetail): BrandIconSummary {
  return {
    id: detail.id,
    slug: detail.slug,
    name: detail.name,
    category: detail.category,
    status: detail.status,
    tags: detail.tags,
    currentVersion: detail.currentVersion,
    publishedVersion: detail.publishedVersion,
    hasUnpublishedChanges: detail.hasUnpublishedChanges,
    createdBy: detail.createdBy,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

function putSummary(summary: BrandIconSummary) {
  const next = new Map(summaries);
  next.set(summary.id, summary);
  summaries = next;
  commitSeq += 1;
  touched.set(summary.id, commitSeq);
}

/** Áp danh sách từ máy chủ; icon vừa được ghi sau lúc `startSeq` giữ nguyên bản mới hơn của trình duyệt. */
function applyList(icons: readonly BrandIconSummary[], startSeq: number) {
  const next = new Map<string, BrandIconSummary>();
  for (const icon of icons) {
    const mine = summaries.get(icon.id);
    next.set(icon.id, mine && (touched.get(icon.id) ?? 0) > startSeq ? mine : icon);
  }
  for (const [id, mine] of summaries) {
    if (!next.has(id) && (touched.get(id) ?? 0) > startSeq) next.set(id, mine);
  }
  summaries = next;
}

function cacheSpec(id: string, version: number, doc: IconDocument) {
  let byVersion = specs.get(id);
  if (!byVersion) {
    byVersion = new Map();
    specs.set(id, byVersion);
  }
  byVersion.set(version, doc);
}

const needsSpec = (summary: BrandIconSummary) => summary.status !== 'archived' && !exactSpec(summary.id, summary.currentVersion);

/** Nạp spec của phiên bản hiện hành; các lời gọi đồng thời dùng chung một yêu cầu. Ném lỗi nếu không nạp được. */
function fetchSpec(summary: BrandIconSummary): Promise<void> {
  const key = specKey(summary.id, summary.currentVersion);
  const running = specFlights.get(key);
  if (running) return running;
  const flight = api
    .getIconSpec(summary.id, summary.currentVersion)
    .then((response) => {
      const doc = normalizeDocument(response.document);
      if (!doc || doc.id !== summary.id) throw new Error('Dữ liệu icon từ máy chủ không hợp lệ.');
      cacheSpec(summary.id, summary.currentVersion, doc);
    })
    .finally(() => {
      specFlights.delete(key);
    });
  specFlights.set(key, flight);
  return flight;
}

async function ensureSpec(summary: BrandIconSummary): Promise<boolean> {
  if (!needsSpec(summary)) return true;
  try {
    await fetchSpec(summary);
    return true;
  } catch {
    return false;
  }
}

async function loadAllSpecs(): Promise<void> {
  const pending = [...summaries.values()].filter(needsSpec);
  let failed = 0;
  await runPool(pending, SPEC_CONCURRENCY, async (summary) => {
    if (!(await ensureSpec(summary))) failed += 1;
  });
  core = { ...core, loading: false, ready: true, error: failed > 0 ? `Không nạp được ${failed} icon từ máy chủ.` : null };
  emit();
}

/* ------------------------------------------------------------ kết nối */

function reasonFor(error: unknown): string {
  if (api.isBrandApiError(error)) {
    if (error.statusCode === 401) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để dùng kho icon trên máy chủ.';
    if (error.statusCode === 403) return 'Tài khoản này không có quyền dùng kho icon trên máy chủ.';
    if (error.statusCode === 404) return 'Máy chủ chưa có API lưu icon.';
    return error.message;
  }
  return 'Không kết nối được máy chủ.';
}

async function runProbe(): Promise<void> {
  const startSeq = commitSeq;
  if (core.mode === 'local') {
    core = { ...core, loading: true };
    emit();
  }
  try {
    const [list, standards] = await Promise.all([
      api.listIcons({ timeoutMs: PROBE_TIMEOUT_MS }),
      api.getStandards({ timeoutMs: PROBE_TIMEOUT_MS }),
    ]);
    applyList(list.icons, startSeq);
    applyProbeStandards(standards);
    core = { ...core, mode: 'server', localReason: null, loading: true, ready: false, error: null };
    emit();
  } catch (error) {
    core = { ...core, mode: 'local', localReason: reasonFor(error), loading: false, ready: false };
    emit();
    return;
  }
  // Người dùng sửa bảng màu từ bản sao trong lúc đang kết nối: gửi ngay khi máy chủ đã sẵn sàng.
  if (standardsDirty) scheduleStandardsFlush(true);
  await loadAllSpecs();
}

function probe(): Promise<void> {
  probing ??= runProbe().finally(() => {
    probing = null;
  });
  return probing;
}

function ensureInitialized() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  if (typeof fetch !== 'function') {
    core = { ...core, mode: 'local', localReason: 'Trình duyệt không hỗ trợ kết nối máy chủ.' };
    snapshot = buildSnapshot();
    return;
  }
  core = { ...core, mode: 'checking', loading: true, standards: readStandardsCache() };
  snapshot = buildSnapshot();
  void probe();
}

/** Nạp lại danh sách và spec đã đổi (chỉ spec của phiên bản chưa có). Ở chế độ cục bộ thì thử kết nối lại. */
async function reload(): Promise<void> {
  if (core.mode !== 'server') {
    await probe();
    return;
  }
  const startSeq = commitSeq;
  core = { ...core, loading: true };
  emit();
  try {
    const list = await api.listIcons();
    applyList(list.icons, startSeq);
  } catch (error) {
    core = { ...core, loading: false, error: api.errorMessage(error) };
    emit();
    throw error;
  }
  await loadAllSpecs();
}

/** Nạp phiên bản mới nhất của một icon và bỏ thay đổi chưa ghi của người dùng trên icon đó. */
async function reloadIcon(id: string): Promise<void> {
  const summary = pickSummary(await api.getIcon(id));
  await fetchSpecIfNeeded(summary);
  overlay.delete(id);
  putSummary(summary);
  emit();
}

async function fetchSpecIfNeeded(summary: BrandIconSummary): Promise<void> {
  if (needsSpec(summary)) await fetchSpec(summary);
}

/* ------------------------------------------------------------ bảng màu và quy chuẩn */

function applyProbeStandards(response: BrandStandardsResponse) {
  const server = toStandards(response);
  const mine = core.standards;
  // Sửa trong lúc đang kết nối chỉ giữ lại khi vẫn dựa trên đúng phiên bản của máy chủ, tránh ghi đè bản người khác lưu.
  if (standardsDirty && mine && mine.version === server.version) return;
  const notice = standardsDirty ? 'Bảng màu và quy chuẩn vừa được người khác thay đổi. Đã nạp bản mới nhất.' : null;
  standardsDirty = false;
  core = { ...core, standards: server, standardsError: notice };
  writeStandardsCache(server);
}

async function reloadStandards(notice: string | null = null): Promise<void> {
  try {
    const server = toStandards(await api.getStandards());
    standardsDirty = false;
    core = { ...core, standards: server, standardsSaving: false, standardsError: notice };
    writeStandardsCache(server);
  } catch (error) {
    core = { ...core, standardsSaving: false, standardsError: `Không nạp được bảng màu: ${api.errorMessage(error)}` };
  }
  emit();
}

function scheduleStandardsFlush(immediate: boolean) {
  if (standardsTimer) clearTimeout(standardsTimer);
  standardsTimer = null;
  // Đang kết nối: để sau khi có máy chủ; chế độ cục bộ không dùng đường này.
  if (core.mode !== 'server') return;
  if (immediate) {
    void flushStandards();
    return;
  }
  standardsTimer = setTimeout(() => {
    standardsTimer = null;
    void flushStandards();
  }, STANDARDS_DEBOUNCE_MS);
}

async function writeStandards(): Promise<void> {
  const sent = core.standards;
  if (!sent) return;
  standardsDirty = false;
  core = { ...core, standardsSaving: true };
  emit();
  try {
    const response = await api.saveStandards({ palette: sent.palette, rules: sent.rules, baseVersion: sent.version });
    // Chỉ nhận số phiên bản mới: nội dung giữ nguyên bản người dùng, vì họ có thể vừa sửa tiếp trong lúc chờ.
    const current = core.standards ?? sent;
    const standards: StandardsState = { ...current, version: response.version };
    core = { ...core, standards, standardsSaving: false, standardsError: null };
    writeStandardsCache(standards);
    emit();
    if (standardsDirty) scheduleStandardsFlush(false);
  } catch (error) {
    if (api.isBrandApiError(error) && error.isStandardsConflict) {
      await reloadStandards('Bảng màu và quy chuẩn vừa được người khác thay đổi. Đã nạp bản mới nhất.');
      return;
    }
    standardsDirty = true;
    core = { ...core, standardsSaving: false, standardsError: `Chưa lưu được bảng màu: ${api.errorMessage(error)}` };
    emit();
  }
}

/** Gửi thay đổi bảng màu và quy chuẩn đang chờ (nếu có) và chờ xong. */
async function flushStandards(): Promise<void> {
  if (standardsTimer) {
    clearTimeout(standardsTimer);
    standardsTimer = null;
  }
  if (standardsFlight) {
    await standardsFlight;
    if (!standardsDirty) return;
  }
  if (!standardsDirty || core.mode !== 'server' || !core.standards) return;
  standardsFlight = writeStandards().finally(() => {
    standardsFlight = null;
  });
  await standardsFlight;
}

/** Sửa bảng màu hoặc quy chuẩn: hiện ngay, lưu bản sao, rồi gửi lên máy chủ sau một nhịp (hoặc ngay nếu `immediate`). */
function setStandards(patch: { readonly palette?: BrandPalette; readonly rules?: BrandRules }, immediate = false) {
  ensureInitialized();
  const current = core.standards ?? { version: 0, palette: DEFAULT_PALETTE, rules: DEFAULT_RULES };
  const standards: StandardsState = { ...current, ...patch };
  core = { ...core, standards, standardsError: null };
  standardsDirty = true;
  writeStandardsCache(standards);
  emit();
  scheduleStandardsFlush(immediate);
}

/* ------------------------------------------------------------ thao tác ghi (dùng cho remote-library) */

/** Bắt đầu một thay đổi: hiện ngay `doc` (hoặc ẩn icon nếu null) khi chờ máy chủ trả lời. */
function begin(id: string, doc: IconDocument | null) {
  overlay.set(id, doc);
  emit();
}

/** Máy chủ từ chối hoặc lỗi: bỏ phần hiện tạm, thư viện trở về đúng như trên máy chủ. */
function revert(id: string) {
  overlay.delete(id);
  emit();
}

/** Máy chủ đã ghi: nhận bản tóm tắt mới (và spec của phiên bản vừa lưu nếu biết) làm sự thật. */
function commit(summary: BrandIconSummary, saved?: { readonly version: number; readonly doc: IconDocument }) {
  putSummary(summary);
  if (saved) cacheSpec(summary.id, saved.version, saved.doc);
  overlay.delete(summary.id);
  emit();
  // Phiên bản mới mà chưa có spec (lưu trùng nội dung, hoặc không dựng lại được): nạp nền rồi cập nhật.
  if (needsSpec(summary)) void ensureSpec(summary).then((ok) => ok && emit());
}

function resetForTest() {
  if (standardsTimer) clearTimeout(standardsTimer);
  standardsTimer = null;
  standardsFlight = null;
  standardsDirty = false;
  core = INITIAL_CORE;
  summaries = new Map();
  specs.clear();
  specFlights.clear();
  overlay.clear();
  derived.clear();
  touched.clear();
  commitSeq = 0;
  snapshot = SERVER_SNAPSHOT;
  initialized = false;
  probing = null;
}

export const remoteStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): RemoteSnapshot {
    ensureInitialized();
    return snapshot;
  },
  getServerSnapshot(): RemoteSnapshot {
    return SERVER_SNAPSHOT;
  },

  reload,
  reloadIcon,
  reloadStandards: () => reloadStandards(),
  setStandards,
  flushStandards,
  /** Lần thử kết nối đang chạy (hoặc đã xong). */
  settled: (): Promise<void> => probing ?? Promise.resolve(),

  getSummary: (id: string): BrandIconSummary | undefined => summaries.get(id),
  /** Bản đang hiển thị của icon (đã áp thay đổi chờ ghi). */
  getDoc: (id: string): IconDocument | undefined => snapshot.docsById.get(id),
  /** Spec đã nạp của đúng phiên bản này. */
  getSpec: exactSpec,
  begin,
  revert,
  commit,

  /** Chỉ dùng cho kiểm thử: về trạng thái chưa khởi tạo (lần đọc kế tiếp thử kết nối lại). */
  resetForTest,
};
