import {
  S3ObjectStorage,
  type ObjectStorageDownloadOptions,
  type ObjectStorageManagementPort,
  type ObjectStorageUpload,
  type S3ObjectStorageOptions,
} from '@enterprise-platform/adapter-storage';
import {
  SHARED_DOCUMENT_MAX_BYTES,
  SHARED_FILE_PROXY_PATH,
  SHARED_PRESIGNED_URL_TTL_SECONDS,
  type SharedStorageLocation,
  type SharedStorageTestResult,
} from '@enterprise-platform/contracts-shared';
import { randomUUID } from 'node:crypto';
import { sharedObjectStorage } from '../application/company-document.service.js';
import type { NasTicketSigner } from '../application/nas.service.js';
import type { SharedStore, StoredObjectRef } from '../application/shared-store.port.js';
import type {
  ExternalStorageAdmin,
  ExternalStorageConfig,
  SharedStorageRouter,
} from '../application/storage-router.port.js';
import { SharedNotProvisionedError, SharedStorageUnavailableError } from '../domain/shared.error.js';
import { endpointPolicy, type EndpointPolicy } from './endpoint-policy.js';
import { StorageSecrets, type FileTicket } from './storage-secrets.js';

/** Kho đọc, ghi được bằng luồng: cần cho chế độ `proxy` và cho việc chuyển tệp giữa hai kho. */
export type StreamingStorage = ObjectStorageManagementPort & Pick<S3ObjectStorage, 'openStream' | 'uploadStream'>;

interface ExternalEntry {
  readonly enabled: boolean;
  /** Kho dùng để ký URL cho trình duyệt: qua máy chủ (`proxy`) hoặc thẳng tới kho (`direct`). */
  readonly port: ObjectStorageManagementPort;
  readonly streams: StreamingStorage;
}

export interface TenantStorageRouterOptions {
  readonly platform?: StreamingStorage;
  /** `null`: chưa có khoá gốc. Bỏ trống: đọc từ biến môi trường. */
  readonly secrets?: StorageSecrets | null;
  readonly policy?: EndpointPolicy;
  readonly createStorage?: (options: S3ObjectStorageOptions) => StreamingStorage;
  /** Tiền tố URL công khai của shared-api; URL tương đối vì mọi phân hệ chung một tên miền. */
  readonly proxyBase?: string;
  readonly cacheMs?: number;
  readonly probeTimeoutMs?: number;
  readonly now?: () => number;
}

const PROBE_BODY = 'enterprise-platform storage probe';

/**
 * Chọn kho đối tượng theo tenant.
 *
 * Cấu hình kho ngoài đọc từ DB tenant, giữ trong bộ nhớ 30 giây; lưu cấu hình
 * thì làm mới ngay ở bản chạy này (bản chạy khác chậm nhất 30 giây). Tenant đã cấu
 * hình kho ngoài mà máy chủ không giải mã được khoá thì báo lỗi, không lặng lẽ
 * quay về kho của nền tảng: tenant bật kho ngoài chính vì không muốn tệp nằm ở đó.
 */
export class TenantStorageRouter implements SharedStorageRouter, ExternalStorageAdmin, NasTicketSigner {
  private readonly platform: StreamingStorage;
  private readonly secrets: StorageSecrets | undefined;
  private readonly policy: EndpointPolicy;
  private readonly createStorage: (options: S3ObjectStorageOptions) => StreamingStorage;
  private readonly proxyBase: string;
  private readonly cacheMs: number;
  private readonly probeTimeoutMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { expires: number; entry: Promise<ExternalEntry | undefined> }>();

  constructor(
    private readonly settings: Pick<SharedStore, 'storageSettings'>,
    options: TenantStorageRouterOptions = {},
  ) {
    this.platform = options.platform ?? sharedObjectStorage();
    this.secrets = options.secrets === null ? undefined : (options.secrets ?? StorageSecrets.fromEnv());
    this.policy = options.policy ?? endpointPolicy();
    this.createStorage = options.createStorage ?? ((storageOptions) => new S3ObjectStorage(storageOptions));
    this.proxyBase = (options.proxyBase ?? process.env.SHARED_FILE_PROXY_BASE ?? '/api/shared').replace(/\/+$/, '');
    this.cacheMs = options.cacheMs ?? 30_000;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 15_000;
    this.now = options.now ?? Date.now;
  }

  get available(): boolean {
    return Boolean(this.secrets);
  }

  async forUpload(tenantId: string) {
    const external = await this.external(tenantId);
    if (external?.enabled) return { location: 'external' as const, storage: external.port };
    return { location: 'platform' as const, storage: this.platform };
  }

  async at(tenantId: string, location: SharedStorageLocation): Promise<ObjectStorageManagementPort> {
    return location === 'platform' ? this.platform : (await this.requireExternal(tenantId)).port;
  }

  /** Kho đọc, ghi bằng luồng ở `location`: route chuyển tiếp tệp và việc chuyển kho dùng. */
  async streamsAt(tenantId: string, location: SharedStorageLocation): Promise<StreamingStorage> {
    return location === 'platform' ? this.platform : (await this.requireExternal(tenantId)).streams;
  }

  async copy(tenantId: string, from: StoredObjectRef, to: StoredObjectRef, contentType: string) {
    if (from.location === to.location) {
      const storage = await this.at(tenantId, from.location);
      await storage.copyObject({ from: from.key, to: to.key });
      return {};
    }
    const source = await this.streamsAt(tenantId, from.location);
    const target = await this.streamsAt(tenantId, to.location);
    const object = await source.openStream(from.key);
    try {
      return await target.uploadStream(to.key, object.body, contentType);
    } finally {
      object.body.destroy();
    }
  }

  /** Phiếu chuyển tiếp hợp lệ (đúng chữ ký, còn hạn, đúng thao tác), hoặc `undefined`. */
  verifyTicket(token: string, operation: FileTicket['o']): FileTicket | undefined {
    return this.secrets?.verifyTicket(token, operation, this.now());
  }

  /** URL tải tệp trên NAS qua route chuyển tiếp; `k` là đường dẫn đầy đủ trên NAS. */
  nasDownloadUrl(input: { tenantId: string; fullPath: string; fileName: string; inline: boolean; contentType?: string }): string {
    return this.ticketUrl({
      t: input.tenantId,
      k: input.fullPath,
      o: 'get',
      e: this.expiry(),
      p: 'nas',
      n: input.fileName,
      c: input.contentType,
      d: input.inline ? 'inline' : 'attachment',
    });
  }

  /** URL tải lên NAS: `k` là thư mục đích, `n` tên tệp, `m` đúng số byte của tệp. */
  nasUploadUrl(input: { tenantId: string; folderFullPath: string; fileName: string; sizeBytes: number }): string {
    return this.ticketUrl({
      t: input.tenantId,
      k: input.folderFullPath,
      o: 'put',
      e: this.expiry(),
      p: 'nas',
      n: input.fileName,
      m: input.sizeBytes,
    });
  }

  encryptSecret(plain: string): string {
    return this.requireSecrets().encrypt(plain);
  }

  decryptSecret(cipher: string): string {
    return this.requireSecrets().decrypt(cipher);
  }

  checkEndpoint(endpoint: string): Promise<string | undefined> {
    return this.policy.check(endpoint);
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  /** Ghi, đọc lại, xoá một tệp thử nhỏ; trả lời dễ hiểu thay vì mã lỗi S3. */
  async probe(config: ExternalStorageConfig): Promise<SharedStorageTestResult> {
    const problem = await this.checkEndpoint(config.endpoint);
    if (problem) return { ok: false, message: problem };
    const storage = this.createStorage(s3Options(config));
    const key = `_erp-probe/${randomUUID()}.txt`;
    const started = this.now();
    const timed = <T>(operation: Promise<T>) => withTimeout(operation, this.probeTimeoutMs);
    try {
      await timed(storage.putObject({ key, contentType: 'text/plain', body: PROBE_BODY }));
      const object = await timed(storage.openStream(key));
      const chunks: Buffer[] = [];
      for await (const chunk of object.body) chunks.push(Buffer.from(chunk as Uint8Array));
      if (Buffer.concat(chunks).toString('utf8') !== PROBE_BODY) {
        return { ok: false, message: 'Kho trả về nội dung khác với tệp thử vừa ghi.' };
      }
      const { failed } = await timed(storage.deleteObjects([key]));
      if (failed.length > 0) {
        return { ok: false, message: 'Ghi và đọc được nhưng không xoá được tệp thử: tài khoản cần thêm quyền xoá.' };
      }
      const latencyMs = this.now() - started;
      return { ok: true, message: `Kết nối tốt: ghi, đọc, xoá đều được (${latencyMs} ms).`, latencyMs };
    } catch (error) {
      return { ok: false, message: describeStorageError(error, this.probeTimeoutMs) };
    }
  }

  private expiry(): number {
    return Math.floor(this.now() / 1000) + SHARED_PRESIGNED_URL_TTL_SECONDS;
  }

  private ticketUrl(ticket: FileTicket): string {
    return `${this.proxyBase}/${SHARED_FILE_PROXY_PATH}/${this.requireSecrets().signTicket(ticket)}`;
  }

  private requireSecrets(): StorageSecrets {
    if (!this.secrets) {
      throw new SharedStorageUnavailableError(
        'Máy chủ chưa bật kho lưu trữ ngoài (thiếu SHARED_STORAGE_SECRET_KEY). Liên hệ quản trị nền tảng.',
      );
    }
    return this.secrets;
  }

  private async requireExternal(tenantId: string): Promise<ExternalEntry> {
    const external = await this.external(tenantId);
    if (!external) {
      throw new SharedStorageUnavailableError('Tệp này nằm ở kho lưu trữ ngoài nhưng kho chưa được cấu hình.');
    }
    return external;
  }

  private external(tenantId: string): Promise<ExternalEntry | undefined> {
    const now = this.now();
    const hit = this.cache.get(tenantId);
    if (hit && hit.expires > now) return hit.entry;
    const entry = this.load(tenantId);
    this.cache.set(tenantId, { expires: now + this.cacheMs, entry });
    // Lỗi (DB chập chờn, khoá sai) không nằm lại trong bộ nhớ đệm.
    entry.catch(() => {
      if (this.cache.get(tenantId)?.entry === entry) this.cache.delete(tenantId);
    });
    return entry;
  }

  private async load(tenantId: string): Promise<ExternalEntry | undefined> {
    let row;
    try {
      row = await this.settings.storageSettings.get(tenantId);
    } catch (error) {
      // Bảng cấu hình chưa có (migration chưa tới tenant này): coi như chưa cấu hình.
      if (error instanceof SharedNotProvisionedError) return undefined;
      throw error;
    }
    if (!row) return undefined;
    const secrets = this.requireSecrets();
    let secretAccessKey: string;
    try {
      secretAccessKey = secrets.decrypt(row.secretCiphertext);
    } catch {
      throw new SharedStorageUnavailableError(
        'Không giải mã được khoá của kho lưu trữ ngoài. Quản trị tenant nhập lại secret key trong cấu hình kho.',
      );
    }
    const streams = this.createStorage(s3Options({ ...row, secretAccessKey }));
    const port =
      row.accessMode === 'proxy' ? new ProxiedStorage(tenantId, streams, secrets, this.proxyBase, this.now) : streams;
    return { enabled: row.enabled, port, streams };
  }
}

/**
 * Kho ngoài ở chế độ `proxy`: URL trả cho trình duyệt trỏ về route chuyển tiếp của
 * shared-api (`/api/shared/v1/files/<phiếu>`), không trỏ tới kho. Thao tác phía máy
 * chủ (chép, xoá) gọi thẳng kho.
 */
class ProxiedStorage implements ObjectStorageManagementPort {
  constructor(
    private readonly tenantId: string,
    private readonly inner: StreamingStorage,
    private readonly secrets: StorageSecrets,
    private readonly base: string,
    private readonly now: () => number,
  ) {}

  async createUploadUrl(input: ObjectStorageUpload): Promise<string> {
    return this.url({
      t: this.tenantId,
      k: input.key,
      o: 'put',
      e: this.expiry(input.expiresInSeconds),
      c: input.contentType,
      m: input.sizeBytes ?? SHARED_DOCUMENT_MAX_BYTES,
    });
  }

  async createDownloadUrl(
    key: string,
    expiresInSeconds = SHARED_PRESIGNED_URL_TTL_SECONDS,
    options: ObjectStorageDownloadOptions = {},
  ): Promise<string> {
    return this.url({
      t: this.tenantId,
      k: key,
      o: 'get',
      e: this.expiry(expiresInSeconds),
      c: options.contentType,
      n: options.fileName,
      d: options.inline ? 'inline' : options.attachment ? 'attachment' : undefined,
    });
  }

  putObject(...args: Parameters<ObjectStorageManagementPort['putObject']>) {
    return this.inner.putObject(...args);
  }

  copyObject(...args: Parameters<ObjectStorageManagementPort['copyObject']>) {
    return this.inner.copyObject(...args);
  }

  deleteObjects(...args: Parameters<ObjectStorageManagementPort['deleteObjects']>) {
    return this.inner.deleteObjects(...args);
  }

  private expiry(seconds = SHARED_PRESIGNED_URL_TTL_SECONDS): number {
    return Math.floor(this.now() / 1000) + seconds;
  }

  private url(ticket: FileTicket): string {
    return `${this.base}/${SHARED_FILE_PROXY_PATH}/${this.secrets.signTicket(ticket)}`;
  }
}

function s3Options(config: Omit<ExternalStorageConfig, 'accessMode'> & { publicEndpoint: string | null }): S3ObjectStorageOptions {
  return {
    internalEndpoint: config.endpoint,
    publicEndpoint: config.publicEndpoint || config.endpoint,
    region: config.region || 'us-east-1',
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    forcePathStyle: config.pathStyle,
  };
}

class ProbeTimeoutError extends Error {
  constructor() {
    super('Storage probe timed out');
    this.name = 'ProbeTimeoutError';
  }
}

function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProbeTimeoutError()), milliseconds);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

/** Lỗi kết nối hay lỗi S3 → câu tiếng Việt nói rõ nên kiểm gì. */
export function describeStorageError(error: unknown, timeoutMs = 15_000): string {
  const failure = error as { name?: string; code?: string; message?: string; cause?: { code?: string } } | null;
  const name = failure?.name ?? '';
  const code = failure?.code ?? failure?.cause?.code ?? '';
  if (name === 'ProbeTimeoutError' || name === 'TimeoutError' || name === 'AbortError') {
    return `Kho không phản hồi sau ${Math.round(timeoutMs / 1000)} giây. Kiểm tra địa chỉ, cổng và đường nối (VPN, Tailscale) từ máy chủ ERP tới kho.`;
  }
  if (code === 'ECONNREFUSED') return 'Kho từ chối kết nối: sai cổng, hoặc dịch vụ kho chưa chạy.';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Không phân giải được tên máy chủ kho.';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ETIMEDOUT' || code === 'ECONNRESET') {
    return 'Không tới được máy chủ kho từ máy chủ ERP. Kiểm tra đường nối (VPN, Tailscale) và tường lửa.';
  }
  if (code.startsWith('CERT_') || code.includes('SELF_SIGNED') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    return 'Chứng chỉ HTTPS của kho không hợp lệ.';
  }
  if (name === 'InvalidAccessKeyId') return 'Access key không đúng.';
  if (name === 'SignatureDoesNotMatch') return 'Secret key không đúng.';
  if (name === 'NoSuchBucket') return 'Bucket không tồn tại trên kho.';
  if (name === 'AccessDenied') return 'Tài khoản không có quyền ghi, đọc trên bucket này.';
  const detail = [name, failure?.message].filter(Boolean).join(': ').slice(0, 200);
  return `Kho trả lỗi${detail ? `: ${detail}` : '.'}`;
}
