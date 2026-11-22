import {
  SHARED_NAS_MAX_UPLOAD_BYTES,
  SHARED_NAS_PROVIDERS,
  SHARED_PRESIGNED_URL_TTL_SECONDS,
  type CreateSharedNasUploadRequest,
  type SaveSharedNasConnectionRequest,
  type SharedDownloadMode,
  type SharedDownloadTicket,
  type SharedNasAccess,
  type SharedNasAccount,
  type SharedNasConnectionSettings,
  type SharedNasListing,
  type SharedNasOverview,
  type SharedNasPermission,
  type SharedNasProvider,
  type SharedNasShareConfig,
  type SharedNasSyncResult,
  type SharedNasTestResult,
  type SharedNasUploadTicket,
} from '@enterprise-platform/contracts-shared';
import { Logger } from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  SharedForbiddenError,
  SharedNasNotFoundError,
  SharedNasUnavailableError,
  SharedStorageSettingsConflictError,
  SharedStorageUnavailableError,
  SharedValidationError,
} from '../domain/shared.error.js';
import type { NasCredentials, NasFileStream, NasGateway } from './nas-gateway.port.js';
import {
  hiddenNasEntry,
  nasAccess,
  nasEntryName,
  nasFullPath,
  normalizeNasPath,
  suggestLinks,
  type NasAccountRecord,
} from './nas-rules.js';
import { isSharedManager, type SharedActor } from './shared-actor.js';
import type { NasConnectionRow, SharedStore } from './shared-store.port.js';
import type { ExternalStorageAdmin } from './storage-router.port.js';

/** Ký URL tải lên, tải xuống qua route chuyển tiếp của máy chủ cho tệp trên NAS. */
export interface NasTicketSigner {
  nasDownloadUrl(input: {
    readonly tenantId: string;
    readonly fullPath: string;
    readonly fileName: string;
    readonly inline: boolean;
    readonly contentType?: string;
  }): string;
  nasUploadUrl(input: {
    readonly tenantId: string;
    readonly folderFullPath: string;
    readonly fileName: string;
    readonly sizeBytes: number;
  }): string;
}

const PREVIEW_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};
const LIST_LIMIT_MAX = 1000;

/**
 * Kho NAS: ánh xạ thư mục chia sẻ của NAS công ty vào Tài liệu chung, không sao chép.
 *
 * NAS là gốc của dữ liệu và của quyền: người dùng, nhóm, quyền từng thư mục chia sẻ
 * đồng bộ về theo chu kỳ (`syncMinutes`), tính quyền đúng luật NAS (Không truy cập
 * thắng, rồi Đọc/Ghi, rồi Chỉ đọc). Tài khoản NAS ghép với nhân sự ERP: tự ghép theo
 * thư điện tử, theo quy tắc đặt tên; còn lại quản trị ghép tay, lượt đồng bộ sau không
 * ghi đè ghép tay. Chưa ghép thì không vào được kho NAS. Quyền ghi tài liệu của phân
 * hệ trong ERP vẫn là trần: NAS cho ghi mà ERP chỉ cho xem thì chỉ xem.
 */
export class NasService {
  private readonly logger = new Logger(NasService.name);
  private readonly syncing = new Map<string, Promise<SharedNasSyncResult>>();

  constructor(
    private readonly store: SharedStore,
    private readonly gateway: NasGateway,
    private readonly secrets: Pick<ExternalStorageAdmin, 'available' | 'encryptSecret' | 'decryptSecret' | 'checkEndpoint'>,
    private readonly tickets: NasTicketSigner,
    private readonly now: () => number = Date.now,
  ) {}

  /* ------------------------------------------------------------ quản trị */

  async settings(actor: SharedActor): Promise<SharedNasConnectionSettings> {
    if (!isSharedManager(actor)) throw new SharedForbiddenError('Chỉ quản trị kho xem được kết nối NAS.');
    const [row, accounts] = await Promise.all([this.store.nas.connection(actor.tenantId), this.store.nas.accounts(actor.tenantId)]);
    const updatedByName = row
      ? (await this.store.people.list(actor.tenantId)).find((person) => person.id === row.updatedBy)?.name
      : undefined;
    return {
      available: this.secrets.available,
      editable: actor.isTenantAdmin,
      configured: Boolean(row),
      enabled: row?.enabled ?? false,
      label: row?.label ?? '',
      provider: row?.provider ?? 'synology',
      baseUrl: row?.baseUrl ?? '',
      username: row?.username ?? '',
      hasSecret: Boolean(row?.secretCiphertext),
      shares: row?.shares ?? [],
      syncMinutes: row?.syncMinutes ?? 15,
      lastSync:
        row?.lastSyncAt !== undefined
          ? { at: row.lastSyncAt, ok: row.lastSyncOk ?? false, message: row.lastSyncMessage ?? '' }
          : undefined,
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt,
      updatedByName,
      accounts: accounts.length,
      linkedAccounts: accounts.filter((account) => account.erpUserId).length,
    };
  }

  async test(actor: SharedActor, input?: Partial<SaveSharedNasConnectionRequest>): Promise<SharedNasTestResult> {
    this.requireAdmin(actor);
    const current = await this.store.nas.connection(actor.tenantId);
    try {
      const credentials = await this.credentialsFrom(input, current);
      const shares = await this.gateway.shares(credentials);
      return { ok: true, message: `Kết nối tốt: đọc được ${shares.length} thư mục chia sẻ.`, shares };
    } catch (error) {
      if (error instanceof SharedValidationError || error instanceof SharedNasUnavailableError || error instanceof SharedStorageUnavailableError) {
        return { ok: false, message: error.message };
      }
      throw error;
    }
  }

  async save(actor: SharedActor, input: SaveSharedNasConnectionRequest): Promise<SharedNasConnectionSettings> {
    this.requireAdmin(actor);
    const current = await this.store.nas.connection(actor.tenantId);
    const credentials = await this.credentialsFrom(input, current);
    const shares = parseShares(input?.shares);
    const syncMinutes = input?.syncMinutes === undefined ? (current?.syncMinutes ?? 15) : Number(input.syncMinutes);
    if (!Number.isInteger(syncMinutes) || syncMinutes < 5 || syncMinutes > 1440) {
      throw new SharedValidationError('Chu kỳ đồng bộ từ 5 đến 1440 phút.');
    }
    const enabled = input?.enabled === true;
    if (enabled) {
      if (shares.length === 0) throw new SharedValidationError('Chọn ít nhất một thư mục chia sẻ để ánh xạ.');
      const available = new Set((await this.gateway.shares(credentials)).map((share) => share.name));
      const missing = shares.filter((share) => !available.has(share.name)).map((share) => share.name);
      if (missing.length > 0) throw new SharedValidationError(`NAS không có thư mục chia sẻ: ${missing.join(', ')}.`);
    }
    const label = typeof input?.label === 'string' ? input.label.trim().slice(0, 120) : '';
    const expected = Number.isInteger(input?.version) && current ? input.version : undefined;
    const saved = await this.store.nas.saveConnection(
      actor.tenantId,
      actor.userId,
      {
        enabled,
        label,
        provider: credentials.provider,
        baseUrl: credentials.baseUrl,
        username: credentials.username,
        secretCiphertext: this.secrets.encryptSecret(credentials.password),
        shares,
        syncMinutes,
      },
      expected,
    );
    if (!saved) throw new SharedStorageSettingsConflictError();
    this.logger.log(`Tenant ${actor.tenantId}: kết nối NAS ${enabled ? 'bật' : 'tắt'} (${credentials.baseUrl}, ${shares.length} thư mục) bởi ${actor.userId}.`);
    if (enabled) {
      await this.syncTenant(actor.tenantId).catch((error) =>
        this.logger.warn(`Đồng bộ NAS sau khi lưu hỏng: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
    return this.settings(actor);
  }

  async sync(actor: SharedActor): Promise<SharedNasSyncResult> {
    if (!isSharedManager(actor)) throw new SharedForbiddenError('Chỉ quản trị kho đồng bộ được với NAS.');
    return this.syncTenant(actor.tenantId);
  }

  /**
   * Đọc người dùng, nhóm, quyền từ NAS rồi thay bản sao trong ERP. Mỗi tenant chạy
   * một lượt một lúc. Giữ ghép tay; ghép tự động tính lại mỗi lượt.
   */
  syncTenant(tenantId: string): Promise<SharedNasSyncResult> {
    const running = this.syncing.get(tenantId);
    if (running) return running;
    const task = this.runSync(tenantId).finally(() => this.syncing.delete(tenantId));
    this.syncing.set(tenantId, task);
    return task;
  }

  async accounts(actor: SharedActor): Promise<SharedNasAccount[]> {
    if (!isSharedManager(actor)) throw new SharedForbiddenError('Chỉ quản trị kho xem được tài khoản NAS.');
    const [accounts, people] = await Promise.all([this.store.nas.accounts(actor.tenantId), this.store.people.list(actor.tenantId)]);
    const names = new Map(people.map((person) => [person.id, person.name]));
    return accounts.map((account) => ({
      name: account.name,
      description: account.description,
      disabled: account.disabled,
      groups: account.groups,
      erpUserId: account.erpUserId,
      erpUserName: account.erpUserId ? names.get(account.erpUserId) : undefined,
      linkSource: account.linkSource,
    }));
  }

  async link(actor: SharedActor, name: string, erpUserId: unknown): Promise<SharedNasAccount[]> {
    this.requireAdmin(actor);
    const target = typeof erpUserId === 'string' && erpUserId ? erpUserId : null;
    if (target && !(await this.store.people.list(actor.tenantId)).some((person) => person.id === target)) {
      throw new SharedValidationError('Không thấy nhân sự này trong ERP.');
    }
    if (!(await this.store.nas.linkAccount(actor.tenantId, name, target))) {
      throw new SharedNasNotFoundError(`Không thấy tài khoản NAS ${name}; đồng bộ lại rồi thử.`);
    }
    return this.accounts(actor);
  }

  async permissions(actor: SharedActor, share: string): Promise<SharedNasPermission[]> {
    if (!isSharedManager(actor)) throw new SharedForbiddenError('Chỉ quản trị kho xem được bảng quyền của NAS.');
    const connection = await this.enabledConnection(actor.tenantId);
    this.mappedShare(connection, share);
    const [rules, groups] = await Promise.all([this.store.nas.rules(actor.tenantId), this.store.nas.groups(actor.tenantId)]);
    const members = new Map(groups.map((group) => [group.name, group.members]));
    return rules
      .filter((rule) => rule.share === share)
      .map((rule) => ({
        principalType: rule.principalType,
        principalName: rule.principalName,
        rule: rule.rule,
        members: rule.principalType === 'group' ? members.get(rule.principalName) : undefined,
      }));
  }

  /* ---------------------------------------------------------- người dùng */

  async overview(actor: SharedActor): Promise<SharedNasOverview> {
    const connection = await this.store.nas.connection(actor.tenantId);
    if (!connection?.enabled) return { enabled: false, label: '', shares: [] };
    this.refreshIfStale(actor.tenantId, connection);
    const [account, rules] = await Promise.all([
      this.store.nas.accountForUser(actor.tenantId, actor.userId),
      this.store.nas.rules(actor.tenantId),
    ]);
    const shares = connection.shares.flatMap((share) => {
      const { access, via } = nasAccess(account, rules, share.name);
      if (access === 'none') return [];
      return [
        {
          name: share.name,
          label: share.label || share.name,
          access,
          via,
          writeCappedByErp: access === 'write' && !this.erpCanWrite(actor),
        },
      ];
    });
    return {
      enabled: true,
      label: connection.label || 'Kho NAS',
      account: account?.name,
      shares,
      lastSyncAt: connection.lastSyncAt,
    };
  }

  async list(actor: SharedActor, share: string, pathValue: unknown, offsetValue?: unknown, limitValue?: unknown): Promise<SharedNasListing> {
    const context = await this.resolve(actor, share, 'read');
    const path = normalizeNasPath(pathValue);
    const offset = Math.max(0, Number.parseInt(String(offsetValue ?? 0), 10) || 0);
    const limit = Math.min(LIST_LIMIT_MAX, Math.max(1, Number.parseInt(String(limitValue ?? LIST_LIMIT_MAX), 10) || LIST_LIMIT_MAX));
    const prefix = `${nasFullPath(share, '')}/`;
    const result = await this.gateway.list(context.credentials, nasFullPath(share, path), { offset, limit });
    return {
      share,
      path,
      access: context.access,
      canWrite: context.canWrite,
      entries: result.entries
        .filter((entry) => !hiddenNasEntry(entry.name))
        .map((entry) => ({
          name: entry.name,
          path: entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : path ? `${path}/${entry.name}` : entry.name,
          isDir: entry.isDir,
          sizeBytes: entry.sizeBytes,
          modifiedAt: entry.modifiedAt,
        })),
      total: result.total,
      offset,
    };
  }

  async download(actor: SharedActor, share: string, pathValue: unknown, mode: SharedDownloadMode = 'download'): Promise<SharedDownloadTicket> {
    await this.resolve(actor, share, 'read');
    const path = normalizeNasPath(pathValue);
    if (!path) throw new SharedValidationError('Chọn một tệp để tải.');
    const fileName = path.split('/').pop()!;
    const previewType = PREVIEW_TYPES[fileName.split('.').pop()?.toLowerCase() ?? ''];
    const inline = mode === 'preview';
    if (inline && !previewType) throw new SharedValidationError('Định dạng này chưa xem trước được, hãy tải xuống để mở.');
    await this.store.nas.log(actor.tenantId, actor.userId, { share, path, action: inline ? 'view' : 'download' });
    return {
      downloadUrl: this.tickets.nasDownloadUrl({
        tenantId: actor.tenantId,
        fullPath: nasFullPath(share, path),
        fileName,
        inline,
        contentType: previewType,
      }),
      expiresInSeconds: SHARED_PRESIGNED_URL_TTL_SECONDS,
      fileName,
      contentType: previewType ?? 'application/octet-stream',
    };
  }

  async uploadTicket(actor: SharedActor, share: string, input: CreateSharedNasUploadRequest): Promise<SharedNasUploadTicket> {
    await this.resolve(actor, share, 'write');
    const folder = normalizeNasPath(input?.path);
    const fileName = nasEntryName(input?.fileName, 'Tên tệp');
    const sizeBytes = Number(input?.sizeBytes);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new SharedValidationError('Dung lượng tệp không hợp lệ.');
    if (sizeBytes > SHARED_NAS_MAX_UPLOAD_BYTES) throw new SharedValidationError('Tệp tải lên qua ERP tối đa 5 GB; tệp lớn hơn chép thẳng vào NAS.');
    await this.store.nas.log(actor.tenantId, actor.userId, {
      share,
      path: folder ? `${folder}/${fileName}` : fileName,
      action: 'upload',
      detail: `${sizeBytes} byte`,
    });
    return {
      uploadUrl: this.tickets.nasUploadUrl({ tenantId: actor.tenantId, folderFullPath: nasFullPath(share, folder), fileName, sizeBytes }),
      expiresInSeconds: SHARED_PRESIGNED_URL_TTL_SECONDS,
    };
  }

  async createFolder(actor: SharedActor, share: string, input: { path?: unknown; name?: unknown }): Promise<void> {
    const context = await this.resolve(actor, share, 'write');
    const parent = normalizeNasPath(input?.path);
    const name = nasEntryName(input?.name, 'Tên thư mục');
    await this.gateway.createFolder(context.credentials, nasFullPath(share, parent), name);
    await this.store.nas.log(actor.tenantId, actor.userId, { share, path: parent ? `${parent}/${name}` : name, action: 'create_folder' });
  }

  async rename(actor: SharedActor, share: string, input: { path?: unknown; name?: unknown }): Promise<void> {
    const context = await this.resolve(actor, share, 'write');
    const path = normalizeNasPath(input?.path);
    if (!path) throw new SharedValidationError('Không đổi tên được thư mục chia sẻ từ ERP.');
    const name = nasEntryName(input?.name, 'Tên mới');
    await this.gateway.rename(context.credentials, nasFullPath(share, path), name);
    await this.store.nas.log(actor.tenantId, actor.userId, { share, path, action: 'rename', detail: name });
  }

  /**
   * Chuyển tệp, thư mục (kéo thả trong Kho NAS) vào thư mục khác của cùng thư mục chia sẻ.
   * Không chuyển được thư mục vào chính nó hay thư mục con của nó; mục đã nằm sẵn ở đích thì bỏ qua.
   */
  async move(actor: SharedActor, share: string, input: { paths?: unknown; to?: unknown }): Promise<{ moved: number }> {
    const context = await this.resolve(actor, share, 'write');
    const destination = normalizeNasPath(input?.to);
    const raw = Array.isArray(input?.paths) ? input.paths : [];
    if (raw.length === 0 || raw.length > 200) throw new SharedValidationError('Chọn từ 1 đến 200 mục để chuyển.');
    const paths = [...new Set(raw.map((value) => normalizeNasPath(value)))];
    if (paths.some((path) => !path)) throw new SharedValidationError('Không chuyển được thư mục chia sẻ.');
    for (const path of paths) {
      if (destination === path || destination.startsWith(`${path}/`)) {
        throw new SharedValidationError('Không chuyển được thư mục vào chính nó hay thư mục con của nó.');
      }
    }
    const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');
    const moving = paths.filter((path) => parentOf(path) !== destination);
    if (moving.length === 0) return { moved: 0 };
    await this.gateway.move(
      context.credentials,
      moving.map((path) => nasFullPath(share, path)),
      nasFullPath(share, destination),
    );
    for (const path of moving) {
      await this.store.nas.log(actor.tenantId, actor.userId, { share, path, action: 'move', detail: destination || '/' });
    }
    return { moved: moving.length };
  }

  async remove(actor: SharedActor, share: string, input: { path?: unknown }): Promise<void> {
    const context = await this.resolve(actor, share, 'write');
    const path = normalizeNasPath(input?.path);
    if (!path) throw new SharedValidationError('Không xoá được thư mục chia sẻ từ ERP.');
    await this.gateway.remove(context.credentials, nasFullPath(share, path));
    await this.store.nas.log(actor.tenantId, actor.userId, { share, path, action: 'delete' });
  }

  /* ------------------------------------------- route chuyển tiếp (phiếu đã ký) */

  async openDownload(tenantId: string, fullPath: string, range?: string, signal?: AbortSignal): Promise<NasFileStream> {
    const connection = await this.enabledConnection(tenantId);
    return this.gateway.download(this.decrypt(connection), fullPath, { range, signal });
  }

  async acceptUpload(tenantId: string, folderFullPath: string, fileName: string, body: Readable, sizeBytes: number, signal?: AbortSignal): Promise<void> {
    const connection = await this.enabledConnection(tenantId);
    await this.gateway.upload(this.decrypt(connection), folderFullPath, fileName, body, sizeBytes, { overwrite: false, signal });
  }

  /* ------------------------------------------------------------ nội bộ */

  private async runSync(tenantId: string): Promise<SharedNasSyncResult> {
    const connection = await this.enabledConnection(tenantId);
    try {
      const snapshot = await this.gateway.directory(this.decrypt(connection), connection.shares.map((share) => share.name));
      const [existing, people] = await Promise.all([this.store.nas.accounts(tenantId), this.store.people.list(tenantId)]);
      const personIds = new Set(people.map((person) => person.id));
      const manual = new Map(existing.filter((account) => account.linkSource === 'manual').map((account) => [account.name, account]));
      const takenByManual = new Set([...manual.values()].map((account) => account.erpUserId).filter((id): id is string => Boolean(id)));
      const proposals = suggestLinks(
        snapshot.accounts.filter((account) => !manual.has(account.name)),
        people.filter((person) => person.active && !takenByManual.has(person.id)).map((person) => ({ userId: person.id, name: person.name, email: person.email })),
      );
      const accounts: NasAccountRecord[] = snapshot.accounts.map((account) => {
        const kept = manual.get(account.name);
        if (kept) {
          return { ...account, erpUserId: kept.erpUserId && personIds.has(kept.erpUserId) ? kept.erpUserId : undefined, linkSource: 'manual' as const };
        }
        const proposed = proposals.get(account.name);
        return { ...account, erpUserId: proposed, linkSource: proposed ? ('auto' as const) : ('none' as const) };
      });
      await this.store.nas.replaceDirectory(tenantId, {
        accounts,
        groups: snapshot.groups,
        rules: snapshot.permissions.map((rule) => ({ ...rule })),
      });
      const linked = accounts.filter((account) => account.erpUserId).length;
      const message = `Đã đồng bộ ${accounts.length} tài khoản, ${snapshot.groups.length} nhóm, quyền của ${connection.shares.length} thư mục; ${linked} tài khoản đã ghép nhân sự.`;
      await this.store.nas.recordSync(tenantId, { ok: true, message });
      return { at: new Date(this.now()).toISOString(), ok: true, message, accounts: accounts.length, groups: snapshot.groups.length, linked };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.nas.recordSync(tenantId, { ok: false, message }).catch(() => undefined);
      throw error;
    }
  }

  private refreshIfStale(tenantId: string, connection: NasConnectionRow): void {
    const last = connection.lastSyncAt ? Date.parse(connection.lastSyncAt) : 0;
    if (this.now() - last < connection.syncMinutes * 60_000 || this.syncing.has(tenantId)) return;
    void this.syncTenant(tenantId).catch((error) =>
      this.logger.warn(`Đồng bộ NAS định kỳ của tenant ${tenantId} hỏng: ${error instanceof Error ? error.message : String(error)}`),
    );
  }

  private async resolve(actor: SharedActor, share: string, need: 'read' | 'write') {
    const connection = await this.enabledConnection(actor.tenantId);
    this.mappedShare(connection, share);
    const account = await this.store.nas.accountForUser(actor.tenantId, actor.userId);
    if (!account) {
      throw new SharedForbiddenError('Tài khoản ERP của bạn chưa được ghép với tài khoản NAS. Nhờ quản trị ghép trong Dung lượng → Kết nối NAS.');
    }
    const { access } = nasAccess(account, await this.store.nas.rules(actor.tenantId), share);
    if (access === 'none') throw new SharedForbiddenError(`Tài khoản NAS ${account.name} không có quyền vào thư mục ${share}.`);
    const canWrite = access === 'write' && this.erpCanWrite(actor);
    if (need === 'write' && !canWrite) {
      throw new SharedForbiddenError(
        access === 'write'
          ? 'NAS cho bạn ghi nhưng tài khoản ERP chưa có quyền ghi tài liệu công ty.'
          : `Tài khoản NAS ${account.name} chỉ có quyền đọc thư mục ${share}.`,
      );
    }
    return { credentials: this.decrypt(connection), access: access as Exclude<SharedNasAccess, 'none'>, canWrite };
  }

  private erpCanWrite(actor: SharedActor): boolean {
    return actor.canWriteDocuments || isSharedManager(actor);
  }

  private async enabledConnection(tenantId: string): Promise<NasConnectionRow> {
    const connection = await this.store.nas.connection(tenantId);
    if (!connection?.enabled) throw new SharedNasNotFoundError('Kho NAS chưa được bật.');
    return connection;
  }

  private mappedShare(connection: NasConnectionRow, share: string): SharedNasShareConfig {
    const found = connection.shares.find((item) => item.name === share);
    if (!found) throw new SharedNasNotFoundError(`Thư mục ${share} không nằm trong các thư mục NAS được ánh xạ.`);
    return found;
  }

  private decrypt(connection: NasConnectionRow): NasCredentials {
    let password: string;
    try {
      password = this.secrets.decryptSecret(connection.secretCiphertext);
    } catch {
      throw new SharedStorageUnavailableError('Không giải mã được mật khẩu NAS. Quản trị tenant nhập lại mật khẩu trong Kết nối NAS.');
    }
    return { provider: connection.provider, baseUrl: connection.baseUrl, username: connection.username, password };
  }

  private requireAdmin(actor: SharedActor): void {
    if (!actor.isTenantAdmin) throw new SharedForbiddenError('Chỉ quản trị tenant được thay đổi kết nối NAS.');
  }

  /** Thông tin đăng nhập từ form; mật khẩu trống thì dùng mật khẩu đã lưu. */
  private async credentialsFrom(
    input: Partial<SaveSharedNasConnectionRequest> | undefined,
    current: NasConnectionRow | undefined,
  ): Promise<NasCredentials> {
    if (!this.secrets.available) {
      throw new SharedStorageUnavailableError('Máy chủ chưa bật khoá mã hoá (SHARED_STORAGE_SECRET_KEY). Liên hệ quản trị nền tảng.');
    }
    const provider = (input?.provider ?? current?.provider ?? 'synology') as SharedNasProvider;
    if (!SHARED_NAS_PROVIDERS.includes(provider)) throw new SharedValidationError('Loại NAS chưa được hỗ trợ.');
    const baseUrl = (typeof input?.baseUrl === 'string' ? input.baseUrl : (current?.baseUrl ?? '')).trim().replace(/\/+$/, '');
    if (!baseUrl) throw new SharedValidationError('Nhập địa chỉ NAS (ví dụ http://100.64.10.20:5000).');
    if (baseUrl.length > 500) throw new SharedValidationError('Địa chỉ NAS dài quá 500 ký tự.');
    const problem = await this.secrets.checkEndpoint(baseUrl);
    if (problem) throw new SharedValidationError(problem.replace('Địa chỉ kho', 'Địa chỉ NAS'));
    const username = (typeof input?.username === 'string' ? input.username : (current?.username ?? '')).trim();
    if (!username || username.length > 255) throw new SharedValidationError('Nhập tài khoản NAS.');
    const typed = typeof input?.password === 'string' ? input.password : '';
    let password = typed;
    if (!password) {
      if (!current?.secretCiphertext || current.username !== username || current.baseUrl !== baseUrl) {
        throw new SharedValidationError('Nhập mật khẩu tài khoản NAS.');
      }
      password = this.decrypt(current).password;
    }
    return { provider, baseUrl, username, password };
  }
}

function parseShares(value: unknown): SharedNasShareConfig[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const shares: SharedNasShareConfig[] = [];
  for (const item of value as { name?: unknown; label?: unknown }[]) {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name || name.includes('/') || name.length > 255 || seen.has(name)) continue;
    seen.add(name);
    const label = typeof item.label === 'string' ? item.label.trim().slice(0, 120) : '';
    shares.push(label ? { name, label } : { name });
  }
  return shares;
}
