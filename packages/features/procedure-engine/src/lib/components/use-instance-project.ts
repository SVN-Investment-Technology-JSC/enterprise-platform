'use client';

import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { authFetch } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { instanceWorkspaceProject, type InstanceWorkspaceProject } from './instance-source';

const WORKSPACE_API = '/api/workspace/v1';

/** Khoá lưu mã, tên dự án đã tra trên trình duyệt (dùng lại khi tải lại trang). */
export const PROJECT_REFS_STORAGE_KEY = 'procedure.project-refs.v1';
/** Mục đã lưu quá 24 giờ thì bỏ, tra lại. */
export const PROJECT_REFS_TTL_MS = 24 * 60 * 60 * 1000;
/** Trần số mục lưu trên trình duyệt (giữ các mục mới nhất), để khoá không phình theo thời gian. */
const STORAGE_MAX_PROJECTS = 400;
const STORAGE_MAX_WORK_ITEMS = 1000;
/** Trần số id mỗi loại trong một lượt `project-refs` (đúng trần `PROJECT_REFS_MAX` của Workspace). */
export const PROJECT_REFS_REQUEST_MAX = 200;

interface ProjectRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

interface RefsResponse {
  readonly projects?: ReadonlyArray<{ id: string; code: string; name: string }>;
  readonly workItems?: ReadonlyArray<{ id: string; projectId: string }>;
}

/**
 * Bộ nhớ DÙNG CHUNG, đọc đồng bộ, cho mọi nơi hiện tên dự án của hồ sơ: bảng (`useInstanceProjects`), cửa sổ hồ sơ
 * (`useInstanceProject`), Tổng quan. Bảng tra xong thì cửa sổ đọc ngay ở lần vẽ đầu, không gọi lại, không chờ một nhịp.
 *  - `ref: null` / `projectId: null`: Workspace không trả (không có quyền, đã xoá); chỉ nhớ trong phiên trang.
 *  - `stale`: đọc từ trình duyệt, vẫn hiện ngay nhưng tra lại ngầm một lần trong phiên trang.
 */
const projects = new Map<string, { ref: ProjectRef | null; at: number; stale?: boolean }>();
const workItems = new Map<string, { projectId: string | null; at: number; stale?: boolean }>();

/** Đang chờ trong lô hay đang gửi: không hỏi lại. */
const queuedProjects = new Set<string>();
const queuedWorkItems = new Set<string>();
const inflightProjects = new Set<string>();
const inflightWorkItems = new Set<string>();
/** Lượt tra gần nhất bị lỗi: thôi hiện "đang tải", lần hỏi sau thử lại. */
const failedProjects = new Set<string>();
const failedWorkItems = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;

let version = 0;
const listeners = new Set<() => void>();

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = () => version;

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

type StoredRefs = {
  readonly v: 1;
  /** id dự án → [mã, tên, lúc tra (ms)]. */
  readonly projects: Record<string, [string, string, number]>;
  /** id công việc → [id dự án, lúc tra (ms)]. */
  readonly workItems: Record<string, [string, number]>;
};

/** Nạp các mục đã lưu còn hạn (một lần mỗi phiên trang). Dữ liệu hỏng thì bỏ khoá, coi như chưa có gì. */
function hydrate() {
  if (hydrated) return;
  hydrated = true;
  const store = storage();
  if (!store) return;
  let raw: string | null = null;
  try {
    raw = store.getItem(PROJECT_REFS_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  const now = Date.now();
  const fresh = (at: unknown): at is number =>
    typeof at === 'number' && Number.isFinite(at) && at <= now && now - at <= PROJECT_REFS_TTL_MS;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredRefs> | null;
    if (!parsed || typeof parsed !== 'object' || parsed.v !== 1) throw new Error('khuôn lạ');
    for (const [id, entry] of Object.entries(parsed.projects ?? {})) {
      if (!Array.isArray(entry) || projects.has(id)) continue;
      const [code, name, at] = entry;
      if (typeof code !== 'string' || typeof name !== 'string' || !fresh(at)) continue;
      projects.set(id, { ref: { id, code, name }, at, stale: true });
    }
    for (const [id, entry] of Object.entries(parsed.workItems ?? {})) {
      if (!Array.isArray(entry) || workItems.has(id)) continue;
      const [projectId, at] = entry;
      if (typeof projectId !== 'string' || !projectId || !fresh(at)) continue;
      workItems.set(id, { projectId, at, stale: true });
    }
  } catch {
    try {
      store.removeItem(PROJECT_REFS_STORAGE_KEY);
    } catch {
      // Trình duyệt chặn bộ nhớ: bỏ qua.
    }
  }
}

/** Ghi lại các mục đã tra được (mới nhất trước, có trần). Bộ nhớ đầy hay bị chặn thì bỏ qua. */
function persist() {
  const store = storage();
  if (!store) return;
  const latest = <T extends { at: number }>(entries: Iterable<[string, T]>, max: number) =>
    [...entries].sort((left, right) => right[1].at - left[1].at).slice(0, max);
  const body: StoredRefs = {
    v: 1,
    projects: Object.fromEntries(
      latest(
        [...projects].filter((entry): entry is [string, { ref: ProjectRef; at: number }] => entry[1].ref !== null),
        STORAGE_MAX_PROJECTS,
      ).map(([id, { ref, at }]) => [id, [ref.code, ref.name, at]]),
    ),
    workItems: Object.fromEntries(
      latest(
        [...workItems].filter((entry): entry is [string, { projectId: string; at: number }] => entry[1].projectId !== null),
        STORAGE_MAX_WORK_ITEMS,
      ).map(([id, { projectId, at }]) => [id, [projectId, at]]),
    ),
  };
  try {
    store.setItem(PROJECT_REFS_STORAGE_KEY, JSON.stringify(body));
  } catch {
    // Hết chỗ hay bị chặn: lần sau tra lại, không sao.
  }
}

/** Một lượt `GET project-refs` cho tối đa `PROJECT_REFS_REQUEST_MAX` id mỗi loại. */
async function request(projectIds: readonly string[], workItemIds: readonly string[]) {
  const query = new URLSearchParams();
  if (projectIds.length) query.set('projectIds', projectIds.join(','));
  if (workItemIds.length) query.set('workItemIds', workItemIds.join(','));
  const body = await authFetch(`${WORKSPACE_API}/project-refs?${query.toString()}`, { cache: 'no-store' })
    .then(async (response) => (response.ok ? ((await response.json()) as RefsResponse) : null))
    .catch(() => null);
  for (const id of projectIds) inflightProjects.delete(id);
  for (const id of workItemIds) inflightWorkItems.delete(id);
  if (!body) {
    // Lỗi mạng / không có quyền Workspace: giữ những gì đang có (kể cả mục cũ từ trình duyệt), lần sau thử lại.
    for (const id of projectIds) failedProjects.add(id);
    for (const id of workItemIds) failedWorkItems.add(id);
    notify();
    return;
  }
  const now = Date.now();
  const returned = new Set<string>();
  for (const project of body.projects ?? []) {
    returned.add(project.id);
    projects.set(project.id, { ref: { id: project.id, code: project.code, name: project.name }, at: now });
  }
  for (const id of projectIds) if (!returned.has(id)) projects.set(id, { ref: null, at: now });
  const mapped = new Map((body.workItems ?? []).map((item) => [item.id, item.projectId] as const));
  for (const id of workItemIds) {
    const projectId = mapped.get(id) ?? null;
    workItems.set(id, { projectId, at: now });
    // Server trả luôn dự án của công việc; dự án không có trong kết quả là không xem được: nhớ để khỏi hỏi thêm lượt nữa.
    if (projectId && !projects.has(projectId)) projects.set(projectId, { ref: null, at: now });
  }
  persist();
  notify();
}

/**
 * Gom lô: mọi lần hỏi dự án / công việc trong cùng một nhịp được gộp thành MỘT lượt `GET project-refs` (tối đa 200 id mỗi
 * loại một lượt, nhiều hơn thì chia lượt chạy song song). Workspace chỉ trả mã, tên, không tính thống kê.
 */
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const projectIds = [...queuedProjects].sort();
    const workItemIds = [...queuedWorkItems].sort();
    queuedProjects.clear();
    queuedWorkItems.clear();
    for (const id of projectIds) inflightProjects.add(id);
    for (const id of workItemIds) inflightWorkItems.add(id);
    const batches = Math.max(
      Math.ceil(projectIds.length / PROJECT_REFS_REQUEST_MAX),
      Math.ceil(workItemIds.length / PROJECT_REFS_REQUEST_MAX),
    );
    for (let index = 0; index < batches; index += 1) {
      const from = index * PROJECT_REFS_REQUEST_MAX;
      const to = from + PROJECT_REFS_REQUEST_MAX;
      void request(projectIds.slice(from, to), workItemIds.slice(from, to));
    }
  }, 0);
}

/** Xin tra các dự án / công việc còn thiếu (hay mới nạp từ trình duyệt, cần tra lại ngầm). Đã có hay đang hỏi thì thôi. */
function ensure(projectIds: Iterable<string>, workItemIds: Iterable<string>) {
  hydrate();
  let queued = false;
  for (const id of projectIds) {
    const known = projects.get(id);
    if ((known && !known.stale) || queuedProjects.has(id) || inflightProjects.has(id)) continue;
    if (known) projects.set(id, { ...known, stale: false });
    failedProjects.delete(id);
    queuedProjects.add(id);
    queued = true;
  }
  for (const id of workItemIds) {
    const known = workItems.get(id);
    if ((known && !known.stale) || queuedWorkItems.has(id) || inflightWorkItems.has(id)) continue;
    if (known) workItems.set(id, { ...known, stale: false });
    failedWorkItems.delete(id);
    queuedWorkItems.add(id);
    queued = true;
  }
  if (queued) scheduleFlush();
}

/** Chỉ cho test: quên các dự án đã tra (cả bản lưu trên trình duyệt). */
export function resetInstanceProjectCache(): void {
  projects.clear();
  workItems.clear();
  queuedProjects.clear();
  queuedWorkItems.clear();
  inflightProjects.clear();
  inflightWorkItems.clear();
  failedProjects.clear();
  failedWorkItems.clear();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  hydrated = false;
  try {
    storage()?.removeItem(PROJECT_REFS_STORAGE_KEY);
  } catch {
    // Bỏ qua.
  }
}

type LookupInstance = Pick<ProcedureInstance, 'id' | 'workspaceLink' | 'workspaceProject' | 'sourceType' | 'sourceId'>;

interface Lookup {
  readonly base?: InstanceWorkspaceProject;
  readonly workItemId?: string;
  /** Dự án cần tra tên (hồ sơ có id dự án mà chưa chụp tên). */
  readonly projectId?: string;
}

function lookupOf(instance: LookupInstance): Lookup {
  const base = instanceWorkspaceProject(instance);
  const workItemId = base?.workItemId ?? (instance.sourceType === 'workspace_work_item' ? instance.sourceId : undefined);
  if (base?.projectName) return { base };
  return { base, ...(workItemId ? { workItemId } : {}), ...(base?.projectId ? { projectId: base.projectId } : {}) };
}

/** Id cần tra của một hồ sơ: dự án (có id), hay công việc (hồ sơ cũ chỉ biết công việc) rồi dự án của công việc đó. */
function wanted(lookup: Lookup): { projectIds: string[]; workItemIds: string[] } {
  if (lookup.base?.projectName) return { projectIds: [], workItemIds: [] };
  if (lookup.projectId) return { projectIds: [lookup.projectId], workItemIds: [] };
  if (!lookup.workItemId) return { projectIds: [], workItemIds: [] };
  const projectId = workItems.get(lookup.workItemId)?.projectId;
  return projectId ? { projectIds: [projectId], workItemIds: [] } : { projectIds: [], workItemIds: [lookup.workItemId] };
}

/** Đọc đồng bộ từ bộ nhớ chung: dự án đầy đủ tên nếu đã biết; `pending` khi còn đang (hay sẽ) tra. */
function resolveLookup(lookup: Lookup): { project?: InstanceWorkspaceProject; pending: boolean } {
  hydrate();
  const { base, workItemId } = lookup;
  if (base?.projectName) return { project: base, pending: false };
  if (!base?.projectId && !workItemId) return { project: base, pending: false };
  const linked = workItemId && !base?.projectId ? workItems.get(workItemId) : undefined;
  const projectId = base?.projectId || linked?.projectId || undefined;
  const known = projectId ? projects.get(projectId) : undefined;
  if (known?.ref) {
    return {
      project: {
        projectId: known.ref.id,
        projectCode: known.ref.code,
        projectName: known.ref.name,
        ...(workItemId ? { workItemId } : {}),
        ...(base?.workItemCode ? { workItemCode: base.workItemCode } : {}),
      },
      pending: false,
    };
  }
  // Workspace đã trả lời là không có, hay lượt tra lỗi: thôi chờ, giữ những gì hồ sơ có.
  const settled = projectId
    ? known?.ref === null || failedProjects.has(projectId)
    : linked?.projectId === null || (workItemId !== undefined && failedWorkItems.has(workItemId));
  return { project: base, pending: !settled };
}

/**
 * Dự án của hồ sơ để hiện TÊN dự án ở phần thông tin hồ sơ, kèm cờ `pending` khi còn đang tra (để hiện mã dự án hay khung
 * chờ thay vì để trống). Đọc trước từ chính hồ sơ (`instanceWorkspaceProject`); hồ sơ cũ chưa chụp tên dự án, hay mở từ
 * công việc trước khi có `workspaceProject`, thì lấy từ bộ nhớ chung (bảng thường đã tra sẵn, hay bản lưu trên trình
 * duyệt), thiếu mới tra bù từ Workspace. Người xem không có quyền xem dự án bên Workspace thì giữ những gì hồ sơ có.
 */
export function useInstanceProjectLookup(instance: LookupInstance | undefined): {
  readonly project?: InstanceWorkspaceProject;
  readonly pending: boolean;
} {
  const current = useSyncExternalStore(subscribe, getVersion, getVersion);
  const lookup = useMemo(
    () => (instance ? lookupOf(instance) : undefined),
    // Chỉ các trường quyết định dự án; hồ sơ nạp lại (đối tượng mới) mà dự án không đổi thì không tính lại.
    [instance?.id, instance?.workspaceLink, instance?.workspaceProject, instance?.sourceType, instance?.sourceId],
  );
  const need = lookup ? wanted(lookup) : undefined;
  const key = need ? `${need.projectIds.join(',')}|${need.workItemIds.join(',')}` : '|';
  useEffect(() => {
    if (need && (need.projectIds.length || need.workItemIds.length)) ensure(need.projectIds, need.workItemIds);
    // Chỉ tra lại khi tập id cần tra đổi (khoá `key`).
  }, [key]);
  return useMemo(
    () => (lookup ? resolveLookup(lookup) : { pending: false }),
    // `current`: bộ nhớ chung vừa có thêm kết quả.
    [lookup, current],
  );
}

/** Như `useInstanceProjectLookup`, chỉ trả dự án. */
export function useInstanceProject(instance: LookupInstance | undefined): InstanceWorkspaceProject | undefined {
  return useInstanceProjectLookup(instance).project;
}

/**
 * Dự án của MỌI hồ sơ trong một danh sách (id hồ sơ → dự án), cho bảng gom nhóm theo dự án. Đọc trước từ chính hồ sơ;
 * ngay khi danh sách nạp xong thì tra bù MỘT lượt cho mọi dự án (hay công việc) khác nhau còn thiếu tên, không theo từng
 * dòng, vào bộ nhớ chung với `useInstanceProject` (cửa sổ hồ sơ đọc lại, không gọi thêm). Không tra được thì giữ mã dự án.
 */
export function useInstanceProjects(instances: readonly LookupInstance[]): ReadonlyMap<string, InstanceWorkspaceProject> {
  const current = useSyncExternalStore(subscribe, getVersion, getVersion);
  const lookups = useMemo(() => instances.map((instance) => ({ id: instance.id, lookup: lookupOf(instance) })), [instances]);
  const { projectIds, workItemIds } = useMemo(() => {
    const projectSet = new Set<string>();
    const workItemSet = new Set<string>();
    for (const { lookup } of lookups) {
      const need = wanted(lookup);
      for (const id of need.projectIds) projectSet.add(id);
      for (const id of need.workItemIds) workItemSet.add(id);
    }
    return { projectIds: [...projectSet].sort(), workItemIds: [...workItemSet].sort() };
    // `current`: công việc vừa ra dự án thì tra tiếp tên dự án đó (thường đã có sẵn trong cùng lượt).
  }, [lookups, current]);
  const key = `${projectIds.join(',')}|${workItemIds.join(',')}`;
  useEffect(() => {
    if (projectIds.length || workItemIds.length) ensure(projectIds, workItemIds);
    // Chỉ tra lại khi tập id cần tra đổi (khoá `key`).
  }, [key]);

  return useMemo(() => {
    const map = new Map<string, InstanceWorkspaceProject>();
    for (const { id, lookup } of lookups) {
      const { project } = resolveLookup(lookup);
      if (project) map.set(id, project);
    }
    return map;
  }, [lookups, current]);
}
