import type { ObjectStorageManagementPort } from '@enterprise-platform/adapter-storage';
import type {
  SharedStorageAccessMode,
  SharedStorageLocation,
  SharedStorageTestResult,
} from '@enterprise-platform/contracts-shared';
import type { StoredObjectRef } from './shared-store.port.js';

/**
 * Chọn kho đối tượng cho từng tenant: kho của nền tảng, hoặc kho ngoài tenant tự
 * cấu hình (NAS, S3 riêng). Tầng application chỉ biết "tệp mới lưu ở đâu" và
 * "tệp này đang nằm ở đâu", không biết địa chỉ hay khoá của kho.
 */
export interface SharedStorageRouter {
  /** Kho nhận tệp mới của tenant lúc này. */
  forUpload(tenantId: string): Promise<{ readonly location: SharedStorageLocation; readonly storage: ObjectStorageManagementPort }>;
  /** Kho đang giữ tệp ở `location`. Kho ngoài vẫn đọc được khi đã tắt, theo cấu hình đã lưu. */
  at(tenantId: string, location: SharedStorageLocation): Promise<ObjectStorageManagementPort>;
  /**
   * Chép một tệp. Cùng kho thì chép ngay trong kho; khác kho thì máy chủ đọc luồng
   * từ kho nguồn ghi sang kho đích, không lưu ra đĩa. Trả số byte đã chép khi đi qua máy chủ.
   */
  copy(tenantId: string, from: StoredObjectRef, to: StoredObjectRef, contentType: string): Promise<{ readonly sizeBytes?: number }>;
}

/** Cấu hình kho ngoài đã giải mã, dùng để kiểm kết nối hay dựng client. */
export interface ExternalStorageConfig {
  readonly accessMode: SharedStorageAccessMode;
  readonly endpoint: string;
  readonly publicEndpoint: string | null;
  readonly region: string;
  readonly bucket: string;
  readonly pathStyle: boolean;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/** Phần quản trị kho ngoài: mã hoá khoá, kiểm địa chỉ, thử kết nối, làm mới bộ nhớ đệm. */
export interface ExternalStorageAdmin {
  /** Máy chủ đã có khoá mã hoá; chưa có thì không lưu được cấu hình. */
  readonly available: boolean;
  encryptSecret(plain: string): string;
  decryptSecret(cipher: string): string;
  /** Lỗi hiển thị cho người dùng khi địa chỉ kho không được phép. */
  checkEndpoint(endpoint: string): Promise<string | undefined>;
  probe(config: ExternalStorageConfig): Promise<SharedStorageTestResult>;
  invalidate(tenantId: string): void;
}

/** Mọi tenant dùng một kho (kho của nền tảng); dùng trong test và khi chưa dựng bộ chọn kho. */
export function singleStorage(storage: ObjectStorageManagementPort): SharedStorageRouter {
  return {
    forUpload: async () => ({ location: 'platform', storage }),
    at: async () => storage,
    copy: async (_tenantId, from, to) => {
      await storage.copyObject({ from: from.key, to: to.key });
      return {};
    },
  };
}
