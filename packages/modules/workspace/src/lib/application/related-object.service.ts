import {
  clampLinkableLimit,
  linkableModuleOf,
  type LinkableKind,
  type LinkableObject,
} from '@enterprise-platform/contracts-integration';
import {
  RELATED_OBJECT_MAX_PER_ENTITY,
  type CreateRelatedObjectRequest,
  type RelatedObject,
  type RelatedObjectCandidateList,
  type RelatedObjectKind,
  type RelatedObjectKindList,
  type RelatedObjectList,
  type RelatedObjectPreview,
  type RelatedObjectUnavailableReason,
} from '@enterprise-platform/contracts-workspace';
import {
  WorkItemNotFoundError,
  WorkspaceError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import {
  assertProjectWritable,
  hasProjectRole,
  requireProjectRole,
  type ProjectAccess,
  type ProjectService,
} from './project.service.js';
import {
  LinkableProviderError,
  type LinkableFailure,
  type LinkableProvider,
  type LinkableProviderRegistry,
  type LinkableViewer,
  type RelatedObjectSnapshotUpdate,
  type RelatedObjectStore,
  type StoredRelatedObject,
} from './related-object.port.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const KIND_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

/** Lỗi khi một module không dùng được lúc người dùng đang chọn hoặc gắn; câu chữ hiện thẳng cho người dùng. */
export class RelatedModuleError extends WorkspaceError {
  constructor(reason: LinkableFailure) {
    const [code, message, status] =
      reason === 'module_unavailable'
        ? ['RELATED_MODULE_UNAVAILABLE', 'Công ty chưa dùng module này hoặc module chưa hỗ trợ liên kết.', 409]
        : reason === 'forbidden'
          ? ['RELATED_MODULE_FORBIDDEN', 'Bạn không có quyền vào module này.', 403]
          : ['RELATED_MODULE_UNREACHABLE', 'Module chưa phản hồi, vui lòng thử lại sau ít phút.', 503];
    super(code, message, status);
    Object.setPrototypeOf(this, RelatedModuleError.prototype);
  }
}

export class RelatedObjectNotFoundError extends WorkspaceError {
  constructor() {
    super('RELATED_OBJECT_NOT_FOUND', 'Không tìm thấy hồ sơ, hoặc bạn không có quyền xem hồ sơ này.', 404);
    Object.setPrototypeOf(this, RelatedObjectNotFoundError.prototype);
  }
}

/**
 * Đối tượng liên quan: gắn dự án hoặc công việc với hồ sơ ở module khác.
 *
 * "Workspace hiển thị, module gốc sở hữu":
 *  - chỉ lưu con trỏ và nhãn ngắn; thông tin đầy đủ đọc lại mỗi lần xem, dưới danh nghĩa người xem;
 *  - khi gắn, server tự hỏi module gốc (không tin nhãn trình duyệt gửi lên), nên ai không xem được hồ sơ thì không gắn được;
 *  - module tắt, lỗi hay chậm thì mọi thao tác của Workspace vẫn chạy: danh sách rơi về nhãn đã lưu kèm lý do, không 5xx.
 */
export class RelatedObjectService {
  constructor(
    private readonly store: RelatedObjectStore,
    private readonly workspace: WorkspaceStore,
    private readonly projects: ProjectService,
    private readonly providers: LinkableProviderRegistry,
  ) {}

  /** Loại chọn được: gom từ mọi module trả lời được; module lỗi hay không dùng thì chỉ thiếu loại của nó. */
  async kinds(actor: WorkspaceActor, accessToken: string | undefined): Promise<RelatedObjectKindList> {
    if (!accessToken) return { kinds: [] };
    const viewer = viewerOf(actor, accessToken);
    const settled = await Promise.allSettled(
      this.providers.all().map(async (provider) => ({ provider, kinds: await provider.kinds(viewer) })),
    );
    const kinds: RelatedObjectKind[] = [];
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      for (const kind of result.value.kinds) kinds.push(toKind(result.value.provider.moduleKey, kind));
    }
    return { kinds };
  }

  async search(
    actor: WorkspaceActor,
    accessToken: string | undefined,
    kindRaw: unknown,
    qRaw: unknown,
    limitRaw?: unknown,
  ): Promise<RelatedObjectCandidateList> {
    const kind = parseKind(kindRaw);
    const provider = this.providerOf(kind);
    const q = typeof qRaw === 'string' ? qRaw.trim().slice(0, 100) : '';
    const items = await this.call(() =>
      provider.search(viewerOf(actor, requireToken(accessToken)), kind, q, clampLinkableLimit(limitRaw)),
    );
    return { items: items.map((item) => ({ ...item })) };
  }

  /** Xem trước một hồ sơ: thông tin đầy đủ, chuỗi phía trước và gợi ý điền sẵn. */
  async preview(
    actor: WorkspaceActor,
    accessToken: string | undefined,
    kindRaw: unknown,
    idRaw: unknown,
  ): Promise<RelatedObjectPreview> {
    const kind = parseKind(kindRaw);
    const id = parseObjectId(idRaw);
    const viewer = viewerOf(actor, requireToken(accessToken));
    const provider = this.providerOf(kind);
    const [object, labels] = await Promise.all([
      this.resolveOne(provider, viewer, kind, id),
      this.kindLabels(provider, viewer),
    ]);
    return {
      kind,
      id: object.id,
      code: object.code,
      label: object.label,
      status: object.status,
      launchUrl: object.launchUrl,
      kindLabel: labels.get(kind)?.label,
      moduleLabel: labels.get(kind)?.moduleLabel,
      fields: object.fields,
      upstream: object.upstream.map((ref) => ({ ...ref, kindLabel: labels.get(ref.kind)?.label })),
      prefill: object.prefill,
    };
  }

  async listForProject(
    actor: WorkspaceActor,
    accessToken: string | undefined,
    projectId: string,
  ): Promise<RelatedObjectList> {
    const access = await this.projects.access(actor, projectId);
    const rows = await this.store.listByProject(actor.tenantId, projectId);
    return this.present(actor, accessToken, access, rows);
  }

  async listForWorkItem(
    actor: WorkspaceActor,
    accessToken: string | undefined,
    workItemId: string,
  ): Promise<RelatedObjectList> {
    const item = await this.workspace.workItem.findById(actor.tenantId, workItemId);
    if (!item) throw new WorkItemNotFoundError(workItemId);
    const access = await this.projects.access(actor, item.projectId);
    const rows = await this.store.listByEntity(actor.tenantId, 'work_item', item.id);
    return this.present(actor, accessToken, access, rows);
  }

  async linkToProject(
    actor: WorkspaceActor,
    accessToken: string | undefined,
    projectId: string,
    input: CreateRelatedObjectRequest,
  ): Promise<RelatedObject> {
    const access = await this.projects.access(actor, projectId);
    return this.link(actor, accessToken, access, { entityType: 'project', entityId: access.project.id }, input);
  }

  async linkToWorkItem(
    actor: WorkspaceActor,
    accessToken: string | undefined,
    workItemId: string,
    input: CreateRelatedObjectRequest,
  ): Promise<RelatedObject> {
    const item = await this.workspace.workItem.findById(actor.tenantId, workItemId);
    if (!item) throw new WorkItemNotFoundError(workItemId);
    const access = await this.projects.access(actor, item.projectId);
    return this.link(actor, accessToken, access, { entityType: 'work_item', entityId: item.id }, input);
  }

  /** Gỡ liên kết: người đã thêm, hoặc quản lý dự án trở lên. Hồ sơ gốc không bị đụng tới. */
  async unlink(actor: WorkspaceActor, id: string): Promise<void> {
    const row = await this.store.findById(actor.tenantId, id);
    if (!row) throw new RelatedObjectNotFoundError();
    const access = await this.projects.access(actor, row.projectId);
    assertProjectWritable(access.project);
    if (!canRemove(actor, access, row)) requireProjectRole(access, 'manager');
    await this.store.remove(actor.tenantId, row.id);
  }

  /* ------------------------------------------------------------------ nội bộ */

  private async link(
    actor: WorkspaceActor,
    accessToken: string | undefined,
    access: ProjectAccess,
    target: { readonly entityType: 'project' | 'work_item'; readonly entityId: string },
    input: CreateRelatedObjectRequest,
  ): Promise<RelatedObject> {
    requireProjectRole(access, 'member');
    assertProjectWritable(access.project);
    const kind = parseKind(input?.kind);
    const objectId = parseObjectId(input?.objectId);

    const existing = await this.store.listByEntity(actor.tenantId, target.entityType, target.entityId);
    const duplicate = existing.some((row) => row.kind === kind && row.objectId === objectId);
    if (!duplicate && existing.length >= RELATED_OBJECT_MAX_PER_ENTITY) {
      throw new WorkspaceValidationError(
        `Mỗi ${target.entityType === 'project' ? 'dự án' : 'công việc'} gắn tối đa ${RELATED_OBJECT_MAX_PER_ENTITY} đối tượng liên quan.`,
      );
    }

    // Hỏi lại module gốc dưới danh nghĩa người dùng: hồ sơ phải tồn tại và họ phải xem được.
    const viewer = viewerOf(actor, requireToken(accessToken));
    const provider = this.providerOf(kind);
    const [object, labels] = await Promise.all([
      this.resolveOne(provider, viewer, kind, objectId),
      this.kindLabels(provider, viewer),
    ]);

    const saved = await this.store.upsert(actor.tenantId, {
      entityType: target.entityType,
      entityId: target.entityId,
      projectId: access.project.id,
      kind,
      moduleKey: provider.moduleKey,
      kindLabel: labels.get(kind)?.label,
      moduleLabel: labels.get(kind)?.moduleLabel,
      objectId: object.id,
      code: object.code,
      label: object.label,
      status: object.status,
      launchUrl: object.launchUrl,
      createdBy: actor.userId,
      createdByName: actor.displayName || undefined,
    });
    return {
      ...toRelatedObject(saved, canRemove(actor, access, saved)),
      fields: object.fields,
    };
  }

  /**
   * Ghép thông tin đầy đủ vào các dòng đã lưu. Gọi theo lô từng loại, các module song song và cách ly nhau: một module
   * lỗi chỉ làm các dòng của nó rơi về nhãn đã lưu.
   */
  private async present(
    actor: WorkspaceActor,
    accessToken: string | undefined,
    access: ProjectAccess,
    rows: readonly StoredRelatedObject[],
  ): Promise<RelatedObjectList> {
    const canAdd = hasProjectRole(access, 'member') && !access.project.archivedAt;
    if (rows.length === 0) return { items: [], canAdd, degraded: false };
    if (!accessToken) {
      return {
        items: rows.map((row) => ({ ...toRelatedObject(row, canRemove(actor, access, row)), unavailableReason: 'unreachable' })),
        canAdd,
        degraded: true,
      };
    }

    const viewer = viewerOf(actor, accessToken);
    const byKind = new Map<string, StoredRelatedObject[]>();
    for (const row of rows) {
      const group = byKind.get(row.kind);
      if (group) group.push(row);
      else byKind.set(row.kind, [row]);
    }

    const resolved = new Map<string, LinkableObject>();
    const failures = new Map<string, RelatedObjectUnavailableReason>();
    await Promise.all(
      [...byKind].map(async ([kind, group]) => {
        const provider = this.providers.get(linkableModuleOf(kind));
        if (!provider) {
          failures.set(kind, 'module_unavailable');
          return;
        }
        try {
          const objects = await provider.resolve(viewer, kind, [...new Set(group.map((row) => row.objectId))]);
          for (const object of objects) resolved.set(`${kind}:${object.id}`, object);
        } catch (error) {
          failures.set(kind, error instanceof LinkableProviderError ? error.reason : 'unreachable');
        }
      }),
    );

    let degraded = false;
    const updates: RelatedObjectSnapshotUpdate[] = [];
    const items = rows.map((row): RelatedObject => {
      const base = toRelatedObject(row, canRemove(actor, access, row));
      const failure = failures.get(row.kind);
      if (failure) {
        if (failure === 'unreachable') degraded = true;
        return { ...base, unavailableReason: failure };
      }
      const object = resolved.get(`${row.kind}:${row.objectId}`);
      if (!object) return { ...base, unavailableReason: 'not_found' };
      updates.push({
        id: row.id,
        code: object.code,
        label: object.label,
        status: object.status,
        launchUrl: object.launchUrl,
      });
      return {
        ...base,
        code: object.code,
        label: object.label,
        status: object.status,
        launchUrl: object.launchUrl,
        fields: object.fields,
      };
    });

    // Lưu nhãn mới để lần sau module tắt vẫn còn bản gần nhất; hỏng bước này không được làm hỏng câu trả lời.
    await this.store.refreshSnapshots(actor.tenantId, updates).catch(() => undefined);
    return { items, canAdd, degraded };
  }

  private providerOf(kind: string): LinkableProvider {
    const provider = this.providers.get(linkableModuleOf(kind));
    if (!provider) throw new RelatedModuleError('module_unavailable');
    return provider;
  }

  private async resolveOne(
    provider: LinkableProvider,
    viewer: LinkableViewer,
    kind: string,
    id: string,
  ): Promise<LinkableObject> {
    const objects = await this.call(() => provider.resolve(viewer, kind, [id]));
    const object = objects.find((entry) => entry.id === id);
    if (!object) throw new RelatedObjectNotFoundError();
    return object;
  }

  /** Tên loại để lưu kèm; không lấy được thì thôi (không chặn thao tác). */
  private async kindLabels(provider: LinkableProvider, viewer: LinkableViewer): Promise<Map<string, LinkableKind>> {
    try {
      return new Map((await provider.kinds(viewer)).map((kind) => [kind.key, kind]));
    } catch {
      return new Map();
    }
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof LinkableProviderError) throw new RelatedModuleError(error.reason);
      throw error;
    }
  }
}

function viewerOf(actor: WorkspaceActor, accessToken: string): LinkableViewer {
  return { tenantId: actor.tenantId, userId: actor.userId, accessToken };
}

/** Không có token của người dùng thì không gọi sang: gọi bằng danh nghĩa khác là cho họ đọc thứ họ không có quyền. */
function requireToken(accessToken: string | undefined): string {
  if (!accessToken) throw new RelatedModuleError('forbidden');
  return accessToken;
}

function parseKind(value: unknown): string {
  const kind = typeof value === 'string' ? value.trim() : '';
  if (!KIND_PATTERN.test(kind) || kind.length > 64) {
    throw new WorkspaceValidationError('Loại đối tượng liên quan không hợp lệ.');
  }
  return kind;
}

function parseObjectId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 160 || id.includes(',')) {
    throw new WorkspaceValidationError('Thiếu hoặc sai định danh hồ sơ.');
  }
  return id;
}

function canRemove(actor: WorkspaceActor, access: ProjectAccess, row: StoredRelatedObject): boolean {
  if (access.project.archivedAt) return false;
  if (row.createdBy === actor.userId && hasProjectRole(access, 'member')) return true;
  return hasProjectRole(access, 'manager');
}

function toKind(moduleKey: string, kind: LinkableKind): RelatedObjectKind {
  return { key: kind.key, moduleKey, moduleLabel: kind.moduleLabel, label: kind.label, prefill: kind.prefill };
}

function toRelatedObject(row: StoredRelatedObject, removable: boolean): RelatedObject {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    projectId: row.projectId,
    entityLabel: row.entityLabel,
    kind: row.kind,
    moduleKey: row.moduleKey,
    objectId: row.objectId,
    code: row.code,
    label: row.label,
    status: row.status,
    launchUrl: row.launchUrl,
    kindLabel: row.kindLabel,
    moduleLabel: row.moduleLabel,
    fields: [],
    canRemove: removable,
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
  };
}
