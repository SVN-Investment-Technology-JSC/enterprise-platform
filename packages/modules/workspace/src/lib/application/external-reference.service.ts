import {
  EXTERNAL_MODULE_KEYS,
  type CreateExternalReferenceRequest,
  type ExternalModuleKey,
  type ExternalReference,
  type ExternalReferenceList,
} from '@enterprise-platform/contracts-workspace';
import {
  WorkItemNotFoundError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import type { ExternalReferenceReader } from './external-reference.port.js';
import { requireProjectRole, type ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Con trỏ sang hồ sơ ở module khác.
 *
 * "Workspace hiển thị, module gốc sở hữu": service này chỉ lưu con trỏ và
 * đọc nhãn hiện tại để hiển thị. Nó **không bao giờ** ghi sang module khác —
 * việc tạo hồ sơ Quy trình do trình duyệt gọi, dưới danh nghĩa người dùng.
 */
export class ExternalReferenceService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly projects: ProjectService,
    private readonly reader: ExternalReferenceReader,
  ) {}

  /** Con trỏ của một công việc, kèm nhãn đã làm mới nếu module gốc trả lời. */
  async listForWorkItem(
    actor: WorkspaceActor,
    accessToken: string | undefined,
    workItemId: string,
  ): Promise<ExternalReferenceList> {
    const item = await this.store.workItem.findById(actor.tenantId, workItemId);
    if (!item) throw new WorkItemNotFoundError(workItemId);
    await this.projects.access(actor, item.projectId);

    const refs = await this.store.externalRef.listByEntity(actor.tenantId, 'work_item', item.id);
    return this.refresh(actor, accessToken, refs);
  }

  /**
   * Mọi con trỏ của một dự án, trong MỘT lời gọi.
   *
   * Cây cần biết công việc nào chạy theo quy trình mà chưa có con trỏ, để
   * hiện badge "Chưa mở được quy trình". Hỏi từng node sẽ là hàng trăm lượt.
   */
  async listForProject(
    actor: WorkspaceActor,
    accessToken: string | undefined,
    projectId: string,
  ): Promise<ExternalReferenceList> {
    await this.projects.access(actor, projectId);
    const refs = await this.store.externalRef.listByProject(actor.tenantId, projectId);
    return this.refresh(actor, accessToken, refs);
  }

  /**
   * Bước 5 của luồng tạo công việc theo quy trình: lưu con trỏ vừa nhận.
   *
   * Lặp lại được — bấm Thử lại sau khi mạng chập chờn không sinh dòng trùng.
   */
  async link(
    actor: WorkspaceActor,
    workItemId: string,
    input: CreateExternalReferenceRequest,
  ): Promise<ExternalReference> {
    const item = await this.store.workItem.findById(actor.tenantId, workItemId);
    if (!item) throw new WorkItemNotFoundError(workItemId);
    requireProjectRole(await this.projects.access(actor, item.projectId), 'member');

    const moduleKey = parseModuleKey(input?.moduleKey);
    const externalId = requireText(input?.externalId, 'Định danh hồ sơ', 160);

    return this.store.externalRef.upsert(actor.tenantId, actor.userId, {
      entityType: 'work_item',
      entityId: item.id,
      projectId: item.projectId,
      moduleKey,
      externalId,
      externalCode: optionalText(input.externalCode, 100),
      launchUrl: requireLaunchUrl(input.launchUrl),
      cachedLabel: optionalText(input.cachedLabel, 255),
      cachedStatus: optionalText(input.cachedStatus, 64),
    });
  }

  /** Gỡ con trỏ. Không tác động gì tới hồ sơ gốc ở module kia. */
  async unlink(actor: WorkspaceActor, workItemId: string, referenceId: string): Promise<void> {
    const item = await this.store.workItem.findById(actor.tenantId, workItemId);
    if (!item) throw new WorkItemNotFoundError(workItemId);
    requireProjectRole(await this.projects.access(actor, item.projectId), 'member');

    // Xác minh con trỏ thuộc đúng công việc này, để một id lạ không gỡ được
    // con trỏ của công việc khác.
    const reference = await this.store.externalRef.findById(actor.tenantId, referenceId);
    if (!reference || reference.entityId !== item.id) {
      throw new WorkItemNotFoundError(referenceId);
    }
    await this.store.externalRef.remove(actor.tenantId, referenceId);
  }

  /**
   * Làm mới nhãn từ module gốc, rơi về bản cache nếu không được.
   *
   * **Degrade mềm là bắt buộc**: module kia tắt thì trang Workspace vẫn phải
   * dùng được, chỉ những thẻ liên quan hiện cảnh báo. Vì vậy mọi lỗi ở đây bị
   * nuốt và chuyển thành cờ `degraded`, không bao giờ lan ra thành 5xx.
   */
  private async refresh(
    actor: WorkspaceActor,
    accessToken: string | undefined,
    refs: readonly ExternalReference[],
  ): Promise<ExternalReferenceList> {
    if (refs.length === 0) return { items: [], degraded: false };
    // Không có token của người dùng thì không gọi sang: gọi bằng danh nghĩa
    // khác là cho họ đọc thứ họ không có quyền ở module gốc.
    if (!accessToken) return { items: refs, degraded: true };

    const byModule = new Map<ExternalModuleKey, ExternalReference[]>();
    for (const ref of refs) {
      const list = byModule.get(ref.moduleKey);
      if (list) list.push(ref);
      else byModule.set(ref.moduleKey, [ref]);
    }

    let degraded = false;
    const refreshed = new Map<string, ExternalReference>();
    const updates: { id: string; cachedLabel?: string; cachedStatus?: string }[] = [];

    await Promise.all(
      [...byModule].map(async ([moduleKey, group]) => {
        try {
          const snapshots = await this.reader.read(
            { tenantId: actor.tenantId, userId: actor.userId, accessToken },
            moduleKey,
            group.map((ref) => ref.externalId),
          );
          for (const ref of group) {
            const snapshot = snapshots.get(ref.externalId);
            if (!snapshot) continue;
            const next = {
              ...ref,
              externalCode: snapshot.code ?? ref.externalCode,
              cachedLabel: snapshot.label ?? ref.cachedLabel,
              cachedStatus: snapshot.status ?? ref.cachedStatus,
              syncedAt: new Date().toISOString(),
            };
            refreshed.set(ref.id, next);
            updates.push({
              id: ref.id,
              cachedLabel: snapshot.label,
              cachedStatus: snapshot.status,
            });
          }
        } catch {
          degraded = true;
        }
      }),
    );

    // Ghi lại nhãn mới để lần sau module kia tắt vẫn còn bản gần nhất. Hỏng
    // bước này cũng không được làm hỏng câu trả lời — dữ liệu đã có trong tay.
    await this.store.externalRef.refreshCache(actor.tenantId, updates).catch(() => undefined);

    return { items: refs.map((ref) => refreshed.get(ref.id) ?? ref), degraded };
  }
}

function parseModuleKey(value: unknown): ExternalModuleKey {
  const text = String(value ?? '');
  if (!(EXTERNAL_MODULE_KEYS as readonly string[]).includes(text)) {
    throw new WorkspaceValidationError(`Module "${text || '(trống)'}" không hỗ trợ liên kết.`);
  }
  return text as ExternalModuleKey;
}

/**
 * Đường dẫn mở hồ sơ ở module gốc.
 *
 * Chỉ nhận đường dẫn tương đối trong chính hệ thống, bắt đầu bằng
 * `/modules/`. Một URL tuyệt đối hay `javascript:` lọt vào đây sẽ thành liên
 * kết mở ra ngoài — hoặc tệ hơn — ngay trên màn hình của người khác.
 */
function requireLaunchUrl(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!/^\/modules\/[A-Za-z0-9._~\-/#?=&%]*$/.test(text) || text.includes('//')) {
    throw new WorkspaceValidationError(
      'Đường dẫn mở hồ sơ phải là đường dẫn nội bộ bắt đầu bằng /modules/.',
    );
  }
  if (text.length > 255) {
    throw new WorkspaceValidationError('Đường dẫn mở hồ sơ không được dài quá 255 ký tự.');
  }
  return text;
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new WorkspaceValidationError(`${label} không được để trống.`);
  if (text.length > maxLength) {
    throw new WorkspaceValidationError(`${label} không được dài quá ${maxLength} ký tự.`);
  }
  return text;
}

function optionalText(value: unknown, maxLength: number): string | null {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
}
