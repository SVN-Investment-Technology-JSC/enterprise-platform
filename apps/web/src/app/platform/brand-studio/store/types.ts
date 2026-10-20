import type { BrandPalette, BrandRules, IconDocument } from '@enterprise-platform/shared-brand-icon';

/**
 * Thư viện icon. Bản cục bộ lưu ở localStorage; sau này có bản lưu lên máy chủ (MinIO) với cùng giao diện,
 * nên mọi thao tác đều trả Promise.
 */
export interface IconLibrary {
  /** false cho đến khi đọc xong kho (tránh nháy giao diện lúc hydrate). */
  readonly ready: boolean;
  readonly docs: readonly IconDocument[];
  readonly error: string | null;
  get(id: string): IconDocument | undefined;
  /** Tạo mới hoặc ghi đè theo `doc.id`; tự cập nhật `updatedAt`; trả về bản đã lưu. */
  save(doc: IconDocument): Promise<IconDocument>;
  /** Ghi nhiều icon trong một lần lưu (đổi trạng thái hàng loạt...); tự cập nhật `updatedAt` từng icon. */
  saveMany(docs: readonly IconDocument[]): Promise<void>;
  remove(id: string): Promise<void>;
  /** Xoá nhiều icon trong một lần lưu; icon mẫu được giữ lại. Trả về số icon đã xoá. */
  removeMany(ids: readonly string[]): Promise<number>;
  /** Nhân bản thành icon nháp mới (tên thêm " (bản sao)"). */
  duplicate(id: string): Promise<IconDocument | null>;
  /** Gộp icon nạp từ tệp: trùng mã thì được đổi mã mới. Trả về số icon đã thêm. */
  importDocs(docs: readonly IconDocument[]): Promise<number>;
  /** Đưa icon mẫu về bản gốc. */
  resetPreset(id: string): Promise<void>;
}

export interface BrandSettings {
  readonly ready: boolean;
  readonly palette: BrandPalette;
  readonly rules: BrandRules;
  setPalette(palette: BrandPalette): void;
  setRules(rules: BrandRules): void;
  /** Đưa bảng màu và quy chuẩn về mặc định. */
  reset(): void;
}
