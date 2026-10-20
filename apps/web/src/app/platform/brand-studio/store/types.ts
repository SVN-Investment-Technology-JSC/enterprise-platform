import type { BrandPalette, BrandRules, IconDocument } from '@enterprise-platform/shared-brand-icon';

/**
 * Nơi lưu thư viện: `server` là máy chủ (MinIO, nguồn sự thật), `local` là localStorage khi chưa gọi được API,
 * `checking` là lúc đang thử kết nối lần đầu.
 */
export type StoreMode = 'checking' | 'server' | 'local';

/** Thông tin của icon trên máy chủ (chỉ có ở chế độ `server`). */
export interface ServerIconInfo {
  /** Phiên bản mới nhất đã lưu. */
  readonly version: number;
  /** Phiên bản đang phát hành công khai; null khi chưa phát hành. */
  readonly publishedVersion: number | null;
  /** Đã lưu phiên bản mới hơn bản đang phát hành. */
  readonly hasUnpublishedChanges: boolean;
  /** Đường dẫn SVG (màu thương hiệu) của phiên bản mới nhất; chỉ quản trị đăng nhập mới xem được nếu chưa phát hành. */
  readonly svgUrl: string;
  /** Đường dẫn SVG công khai của bản đang phát hành; null khi chưa phát hành. */
  readonly publicSvgUrl: string | null;
}

export interface SyncResult {
  readonly pushed: number;
  readonly failed: number;
}

/**
 * Thư viện icon. Mọi thao tác trả Promise và ném lỗi có `message` tiếng Việt để màn hình hiện lại. Ở chế độ `server`
 * lỗi xung đột phiên bản mang `code === 'BRAND_ICON_VERSION_CONFLICT'`.
 */
export interface IconLibrary {
  /** false cho đến khi đọc xong kho (tránh nháy giao diện lúc hydrate hoặc lúc nạp từ máy chủ). */
  readonly ready: boolean;
  readonly docs: readonly IconDocument[];
  readonly error: string | null;
  /** Nơi đang lưu thư viện. */
  readonly mode: StoreMode;
  /** Lý do đang ở chế độ cục bộ (không có quyền, chưa có API, mất mạng...); null nếu không có. */
  readonly modeReason: string | null;
  /** Số icon chỉ có trong trình duyệt mà máy chủ chưa có (chỉ khác 0 khi `mode === 'server'`). */
  readonly localOnlyCount: number;
  /** Đang nạp thêm từ máy chủ. */
  readonly loading: boolean;
  get(id: string): IconDocument | undefined;
  /** Thông tin phiên bản trên máy chủ; null khi không ở chế độ máy chủ hoặc icon chưa có trên máy chủ. */
  serverInfo(id: string): ServerIconInfo | null;
  /** Tạo mới hoặc ghi đè theo `doc.id`; tự cập nhật `updatedAt`; trả về bản đã lưu. */
  save(doc: IconDocument): Promise<IconDocument>;
  /** Ghi nhiều icon trong một lần lưu (đổi trạng thái hàng loạt...); tự cập nhật `updatedAt` từng icon. */
  saveMany(docs: readonly IconDocument[]): Promise<void>;
  /** Xoá icon (trên máy chủ là lưu trữ, không xoá dữ liệu). Icon mẫu không xoá được. */
  remove(id: string): Promise<void>;
  /** Xoá nhiều icon trong một lần lưu; icon mẫu được giữ lại. Trả về số icon đã xoá. */
  removeMany(ids: readonly string[]): Promise<number>;
  /** Nhân bản thành icon nháp mới (tên thêm " (bản sao)"). */
  duplicate(id: string): Promise<IconDocument | null>;
  /** Gộp icon nạp từ tệp: trùng mã thì được đổi mã mới. Trả về số icon đã thêm. */
  importDocs(docs: readonly IconDocument[]): Promise<number>;
  /** Đưa icon mẫu về bản gốc. */
  resetPreset(id: string): Promise<void>;
  /** Phát hành phiên bản mới nhất của icon (đặt trạng thái "Phát hành" nếu đang lưu cục bộ). */
  publish(id: string): Promise<IconDocument | null>;
  /** Đẩy các icon chỉ có trong trình duyệt lên máy chủ, mỗi icon một yêu cầu. */
  syncLocalToServer(): Promise<SyncResult>;
  /**
   * Nạp lại từ máy chủ: không có `id` thì nạp lại cả thư viện (ở chế độ cục bộ là thử kết nối lại), có `id` thì chỉ
   * nạp phiên bản mới nhất của icon đó và bỏ thay đổi của người dùng trên icon này.
   */
  reloadFromServer(id?: string): Promise<void>;
}

export interface BrandSettings {
  readonly ready: boolean;
  readonly palette: BrandPalette;
  readonly rules: BrandRules;
  /** Nơi lưu bảng màu và quy chuẩn; như `IconLibrary.mode`. */
  readonly mode: StoreMode;
  /** Đang gửi thay đổi lên máy chủ. */
  readonly saving: boolean;
  /** Lỗi lưu hoặc thông báo xung đột (đã nạp lại bản mới nhất); null nếu không có. */
  readonly error: string | null;
  setPalette(palette: BrandPalette): void;
  setRules(rules: BrandRules): void;
  /** Đưa bảng màu và quy chuẩn về mặc định. */
  reset(): void;
}
