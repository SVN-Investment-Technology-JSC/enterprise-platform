import {
  SHARED_STORAGE_ACCESS_MODES,
  type SaveSharedExternalStorageRequest,
  type SharedExternalStorageSettings,
  type SharedStorageAccessMode,
  type SharedStorageTestResult,
  type SharedStorageTransferResult,
} from '@enterprise-platform/contracts-shared';
import { Logger } from '@nestjs/common';
import {
  SharedForbiddenError,
  SharedStorageSettingsConflictError,
  SharedStorageUnavailableError,
  SharedValidationError,
} from '../domain/shared.error.js';
import { isSharedManager, type SharedActor } from './shared-actor.js';
import type { SharedStore, StorageSettingsInput, StorageSettingsRow } from './shared-store.port.js';
import type { ExternalStorageAdmin, ExternalStorageConfig, SharedStorageRouter } from './storage-router.port.js';

/** Tên bucket theo quy tắc S3: 3–63 ký tự thường, số, chấm, gạch ngang. */
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_PATTERN = /^[a-z0-9-]{1,64}$/;
const TRANSFER_BATCH_DEFAULT = 10;
const TRANSFER_BATCH_MAX = 50;

/**
 * Cấu hình kho lưu trữ ngoài của tenant (NAS, MinIO, S3 riêng).
 *
 * Quản trị kho xem được; chỉ quản trị tenant sửa, thử kết nối, chuyển tệp, vì đổi
 * kho là đổi nơi giữ toàn bộ tệp của công ty. Bật kho thì phải thử kết nối được
 * trước khi lưu, để một cấu hình sai không làm hỏng mọi lượt tải lên.
 */
export class StorageSettingsService {
  private readonly logger = new Logger(StorageSettingsService.name);

  constructor(
    private readonly store: SharedStore,
    private readonly storages: SharedStorageRouter & ExternalStorageAdmin,
  ) {}

  async get(actor: SharedActor): Promise<SharedExternalStorageSettings> {
    if (!isSharedManager(actor)) throw new SharedForbiddenError('Chỉ quản trị kho xem được cấu hình kho lưu trữ.');
    const [row, usage] = await Promise.all([
      this.store.storageSettings.get(actor.tenantId),
      this.store.storage.locationUsage(actor.tenantId),
    ]);
    const updatedByName = row
      ? (await this.store.people.list(actor.tenantId)).find((person) => person.id === row.updatedBy)?.name
      : undefined;
    return {
      available: this.storages.available,
      editable: actor.isTenantAdmin,
      configured: Boolean(row),
      enabled: row?.enabled ?? false,
      label: row?.label ?? '',
      accessMode: row?.accessMode ?? 'proxy',
      endpoint: row?.endpoint ?? '',
      publicEndpoint: row?.publicEndpoint ?? '',
      region: row?.region ?? 'us-east-1',
      bucket: row?.bucket ?? '',
      pathStyle: row?.pathStyle ?? true,
      accessKeyId: row?.accessKeyId ?? '',
      hasSecret: Boolean(row?.secretCiphertext),
      updatedAt: row?.updatedAt,
      updatedByName,
      version: row?.version ?? 0,
      usage,
    };
  }

  async save(actor: SharedActor, input: SaveSharedExternalStorageRequest): Promise<SharedExternalStorageSettings> {
    this.requireAdmin(actor);
    if (!this.storages.available) {
      throw new SharedStorageUnavailableError(
        'Máy chủ chưa bật kho lưu trữ ngoài (thiếu SHARED_STORAGE_SECRET_KEY). Liên hệ quản trị nền tảng.',
      );
    }
    const current = await this.store.storageSettings.get(actor.tenantId);
    const { config, label } = await this.parse(input, current);
    const enabled = input?.enabled === true;
    if (enabled) {
      const probe = await this.storages.probe(config);
      if (!probe.ok) throw new SharedValidationError(`Chưa lưu vì chưa kết nối được kho: ${probe.message}`);
    }
    const row: StorageSettingsInput = {
      enabled,
      label,
      accessMode: config.accessMode,
      endpoint: config.endpoint,
      publicEndpoint: config.publicEndpoint,
      region: config.region,
      bucket: config.bucket,
      pathStyle: config.pathStyle,
      accessKeyId: config.accessKeyId,
      secretCiphertext: this.storages.encryptSecret(config.secretAccessKey),
    };
    const expected = Number.isInteger(input?.version) && current ? input.version : undefined;
    const saved = await this.store.storageSettings.save(actor.tenantId, actor.userId, row, expected);
    if (!saved) throw new SharedStorageSettingsConflictError();
    this.storages.invalidate(actor.tenantId);
    this.logger.log(
      `Tenant ${actor.tenantId}: kho ngoài ${enabled ? 'bật' : 'tắt'} (${config.accessMode}, ${config.endpoint}/${config.bucket}) bởi ${actor.userId}.`,
    );
    return this.get(actor);
  }

  /** Thử với giá trị đang nhập trên form (chưa lưu); secret trống thì dùng secret đã lưu. */
  async test(actor: SharedActor, input?: Partial<SaveSharedExternalStorageRequest>): Promise<SharedStorageTestResult> {
    this.requireAdmin(actor);
    if (!this.storages.available) {
      return { ok: false, message: 'Máy chủ chưa bật kho lưu trữ ngoài (thiếu SHARED_STORAGE_SECRET_KEY).' };
    }
    const current = await this.store.storageSettings.get(actor.tenantId);
    const merged: SaveSharedExternalStorageRequest = {
      enabled: true,
      accessMode: input?.accessMode ?? current?.accessMode ?? 'proxy',
      endpoint: input?.endpoint ?? current?.endpoint ?? '',
      publicEndpoint: input?.publicEndpoint ?? current?.publicEndpoint ?? undefined,
      region: input?.region ?? current?.region,
      bucket: input?.bucket ?? current?.bucket ?? '',
      pathStyle: input?.pathStyle ?? current?.pathStyle,
      accessKeyId: input?.accessKeyId ?? current?.accessKeyId ?? '',
      secretAccessKey: input?.secretAccessKey,
    };
    try {
      const { config } = await this.parse(merged, current);
      return await this.storages.probe(config);
    } catch (error) {
      if (error instanceof SharedValidationError || error instanceof SharedStorageUnavailableError) {
        return { ok: false, message: error.message };
      }
      throw error;
    }
  }

  /**
   * Chuyển một lô tệp đang ở kho của nền tảng sang kho ngoài: chép, so số byte, rồi
   * mới ghi phiên bản đã ở kho ngoài. Bản ở kho của nền tảng giữ lại để quay lui,
   * trừ khi người dùng chọn xoá. Giao diện gọi lặp tới khi hết tệp hoặc một lượt
   * không chuyển được tệp nào.
   */
  async transfer(
    actor: SharedActor,
    input?: { limit?: unknown; removePlatformCopy?: unknown },
  ): Promise<SharedStorageTransferResult> {
    this.requireAdmin(actor);
    const settings = await this.store.storageSettings.get(actor.tenantId);
    if (!settings?.enabled) throw new SharedValidationError('Bật và lưu kho lưu trữ ngoài trước khi chuyển tệp.');
    const requested = Number(input?.limit);
    const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), TRANSFER_BATCH_MAX) : TRANSFER_BATCH_DEFAULT;
    const removePlatformCopy = input?.removePlatformCopy === true;

    const batch = await this.store.storage.platformObjects(actor.tenantId, limit);
    let moved = 0;
    const errors: string[] = [];
    for (const item of batch) {
      const label = item.key.split('/').pop() ?? item.key;
      try {
        const { sizeBytes } = await this.storages.copy(
          actor.tenantId,
          { key: item.key, location: 'platform' },
          { key: item.key, location: 'external' },
          item.contentType,
        );
        if (sizeBytes !== undefined && sizeBytes !== item.sizeBytes) {
          throw new Error(`chỉ chép được ${sizeBytes}/${item.sizeBytes} byte`);
        }
        if (!(await this.store.storage.markExternal(actor.tenantId, item.versionId))) continue;
        moved += 1;
        if (removePlatformCopy) {
          const platform = await this.storages.at(actor.tenantId, 'platform');
          const { failed } = await platform.deleteObjects([item.key]).catch(() => ({ failed: [item.key] }));
          if (failed.length > 0) this.logger.warn(`Không xoá được bản ở kho của nền tảng: ${item.key}`);
        }
      } catch (error) {
        errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      moved,
      failed: errors.length,
      remaining: await this.store.storage.countPlatformObjects(actor.tenantId),
      errors: errors.slice(0, 20),
    };
  }

  private requireAdmin(actor: SharedActor): void {
    if (!actor.isTenantAdmin) {
      throw new SharedForbiddenError('Chỉ quản trị tenant được thay đổi kho lưu trữ của công ty.');
    }
  }

  private async parse(
    input: SaveSharedExternalStorageRequest | undefined,
    current: StorageSettingsRow | undefined,
  ): Promise<{ config: ExternalStorageConfig; label: string }> {
    const accessMode = input?.accessMode as SharedStorageAccessMode;
    if (!SHARED_STORAGE_ACCESS_MODES.includes(accessMode)) throw new SharedValidationError('Chọn cách truy cập kho.');

    const endpoint = text(input?.endpoint, 500).replace(/\/+$/, '');
    if (!endpoint) throw new SharedValidationError('Nhập địa chỉ kho (endpoint S3).');
    const endpointProblem = await this.storages.checkEndpoint(endpoint);
    if (endpointProblem) throw new SharedValidationError(endpointProblem);

    let publicEndpoint: string | null = null;
    if (accessMode === 'direct') {
      publicEndpoint = text(input?.publicEndpoint, 500).replace(/\/+$/, '') || null;
      if (!publicEndpoint) throw new SharedValidationError('Chế độ nối thẳng cần địa chỉ công khai của kho cho trình duyệt.');
      let url: URL;
      try {
        url = new URL(publicEndpoint);
      } catch {
        throw new SharedValidationError('Địa chỉ công khai của kho không phải URL hợp lệ.');
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new SharedValidationError('Địa chỉ công khai của kho phải bắt đầu bằng https://.');
      }
      if (url.username || url.password || (url.pathname && url.pathname !== '/') || url.search) {
        throw new SharedValidationError('Địa chỉ công khai chỉ gồm giao thức, máy chủ và cổng.');
      }
    }

    const bucket = text(input?.bucket, 63);
    if (!BUCKET_PATTERN.test(bucket)) {
      throw new SharedValidationError('Tên bucket gồm 3–63 ký tự thường, số, dấu chấm hoặc gạch ngang.');
    }
    const region = text(input?.region, 64) || 'us-east-1';
    if (!REGION_PATTERN.test(region)) throw new SharedValidationError('Region chỉ gồm chữ thường, số và gạch ngang.');
    const accessKeyId = text(input?.accessKeyId, 255);
    if (!accessKeyId) throw new SharedValidationError('Nhập access key.');

    const typedSecret = text(input?.secretAccessKey, 500);
    let secretAccessKey = typedSecret;
    if (!secretAccessKey) {
      if (!current?.secretCiphertext) throw new SharedValidationError('Nhập secret key.');
      try {
        secretAccessKey = this.storages.decryptSecret(current.secretCiphertext);
      } catch {
        throw new SharedValidationError('Không giải mã được secret key đã lưu; nhập lại secret key.');
      }
    }

    return {
      config: {
        accessMode,
        endpoint,
        publicEndpoint,
        region,
        bucket,
        pathStyle: input?.pathStyle ?? true,
        accessKeyId,
        secretAccessKey,
      },
      label: text(input?.label, 120),
    };
  }
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length > max) throw new SharedValidationError(`Giá trị nhập dài quá ${max} ký tự.`);
  return trimmed;
}
