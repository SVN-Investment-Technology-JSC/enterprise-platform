import type { SharedNasProvider, SharedNasRule } from '@enterprise-platform/contracts-shared';
import type { Readable } from 'node:stream';

/** Thông tin đăng nhập NAS đã giải mã; chỉ sống trong bộ nhớ của lời gọi. */
export interface NasCredentials {
  readonly provider: SharedNasProvider;
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
}

export interface NasDirectorySnapshot {
  readonly accounts: readonly {
    readonly name: string;
    readonly description: string;
    readonly email?: string;
    readonly disabled: boolean;
    readonly groups: readonly string[];
  }[];
  readonly groups: readonly { readonly name: string; readonly description: string; readonly members: number }[];
  readonly permissions: readonly {
    readonly share: string;
    readonly principalType: 'user' | 'group';
    readonly principalName: string;
    readonly rule: SharedNasRule;
  }[];
}

export interface NasListedEntry {
  readonly name: string;
  /** Đường dẫn đầy đủ trên NAS: "/SAVINA/a/b.pdf". */
  readonly path: string;
  readonly isDir: boolean;
  readonly sizeBytes?: number;
  readonly modifiedAt?: string;
}

export interface NasFileStream {
  readonly body: Readable;
  readonly partial: boolean;
  readonly contentType?: string;
  readonly contentLength?: number;
  readonly contentRange?: string;
  readonly lastModified?: string;
}

/**
 * Cổng nói chuyện với NAS. Bản đầu là Synology DSM (File Station API); NAS hãng khác
 * thêm một bản cài đặt mới, tầng application không đổi.
 *
 * Lỗi ném ra là `SharedError` (không thấy, trùng tên, NAS không kết nối được…) với
 * câu tiếng Việt hiển thị thẳng cho người dùng.
 */
export interface NasGateway {
  /** Đăng nhập thử và liệt kê thư mục chia sẻ. */
  shares(credentials: NasCredentials): Promise<{ readonly name: string; readonly description?: string }[]>;
  /** Người dùng, nhóm, thành viên nhóm và quyền của các thư mục chia sẻ `shares`. */
  directory(credentials: NasCredentials, shares: readonly string[]): Promise<NasDirectorySnapshot>;
  list(
    credentials: NasCredentials,
    fullPath: string,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<{ readonly entries: readonly NasListedEntry[]; readonly total: number }>;
  createFolder(credentials: NasCredentials, parentFullPath: string, name: string): Promise<void>;
  rename(credentials: NasCredentials, fullPath: string, name: string): Promise<void>;
  remove(credentials: NasCredentials, fullPath: string): Promise<void>;
  /** Chuyển các mục vào thư mục đích; đích có mục cùng tên thì báo trùng, không ghi đè. */
  move(credentials: NasCredentials, fullPaths: readonly string[], destinationFullPath: string): Promise<void>;
  download(credentials: NasCredentials, fullPath: string, options?: { range?: string; signal?: AbortSignal }): Promise<NasFileStream>;
  upload(
    credentials: NasCredentials,
    folderFullPath: string,
    fileName: string,
    body: Readable,
    sizeBytes: number,
    options?: { overwrite?: boolean; signal?: AbortSignal },
  ): Promise<void>;
}
