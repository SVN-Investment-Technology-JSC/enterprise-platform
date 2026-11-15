import { ShieldAlert } from 'lucide-react';
import styles from './access-denied.module.css';

/**
 * Lỗi gọi API giữ lại mã HTTP để giao diện phân biệt "chưa được cấp quyền" (403) với lỗi hệ thống.
 * `message` là câu tiếng Việt server trả (`{ statusCode, code, message }`), hoặc câu dự phòng của nơi gọi.
 */
export class ApiRequestError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Câu chung khi server từ chối thao tác mà không kèm lời giải thích. */
export const ACTION_DENIED_MESSAGE = 'Bạn không có quyền thực hiện thao tác này. Liên hệ quản trị để được cấp quyền.';

function pickMessage(body: unknown): string | undefined {
  const raw = (body as { message?: unknown } | null | undefined)?.message;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  // ValidationPipe của Nest trả mảng câu.
  if (Array.isArray(raw)) {
    const joined = raw.filter((item): item is string => typeof item === 'string' && item.trim() !== '').join('; ');
    return joined || undefined;
  }
  return undefined;
}

/**
 * Dựng lỗi từ phản hồi không thành công. Ưu tiên `message` tiếng Việt của server; 403 không kèm câu nào (hoặc chỉ là
 * "Forbidden" mặc định của framework) thì dùng câu chung tiếng Việt thay vì lộ lỗi kỹ thuật.
 */
export async function readApiRequestError(response: Response, fallback: string): Promise<ApiRequestError> {
  const body: unknown = await response.json().catch(() => undefined);
  const code = (body as { code?: unknown } | undefined)?.code;
  let message = pickMessage(body);
  if (response.status === 403 && (!message || message === 'Forbidden' || message.startsWith('Forbidden resource'))) {
    message = ACTION_DENIED_MESSAGE;
  }
  return new ApiRequestError(response.status, message ?? fallback, typeof code === 'string' ? code : undefined);
}

/** Lỗi là do chưa được cấp quyền (HTTP 403), không phải lỗi hệ thống. */
export function isAccessDeniedError(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false;
  const value = cause as { statusCode?: unknown; status?: unknown };
  return value.statusCode === 403 || value.status === 403;
}

/** Câu hiện khi người dùng không có quyền vào cả phân hệ. */
export function moduleAccessDeniedMessage(moduleLabel: string): string {
  return `Bạn chưa được cấp quyền dùng phân hệ ${moduleLabel}. Liên hệ quản trị để được cấp quyền.`;
}

export interface AccessDeniedNoticeProps {
  /** Tên phân hệ hiển thị, ví dụ "Bảo trì". */
  readonly moduleLabel?: string;
  /** Câu thay cho câu mặc định (ví dụ chỉ thiếu quyền một màn). */
  readonly message?: string;
  readonly title?: string;
}

/** Khối báo "chưa được cấp quyền" thay cho thông báo lỗi kỹ thuật khi API trả 403. */
export function AccessDeniedNotice({ moduleLabel, message, title = 'Chưa được cấp quyền' }: AccessDeniedNoticeProps) {
  const text = message ?? (moduleLabel ? moduleAccessDeniedMessage(moduleLabel) : ACTION_DENIED_MESSAGE);
  return (
    <section className={styles.notice} role="alert" aria-live="polite">
      <ShieldAlert className={styles.icon} aria-hidden="true" />
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.text}>{text}</p>
    </section>
  );
}
