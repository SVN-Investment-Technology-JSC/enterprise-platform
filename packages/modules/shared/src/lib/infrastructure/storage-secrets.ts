import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/** Biến môi trường giữ khoá gốc; thiếu thì bản deploy này chưa bật kho ngoài. */
export const STORAGE_SECRET_ENV = 'SHARED_STORAGE_SECRET_KEY';

/** Khoá gốc ngắn hơn mức này coi như chưa đặt: dễ đoán, không đủ làm khoá mã hoá. */
const MIN_SECRET_LENGTH = 32;
const CIPHER_PREFIX = 'v1';

/**
 * Phiếu cho một lượt chuyển tiếp tệp qua máy chủ (chế độ `proxy`): giống URL ký
 * sẵn của S3, ai cầm phiếu còn hạn thì đọc hoặc ghi đúng một khoá, không cần phiên
 * đăng nhập. Trường viết tắt để URL ngắn.
 */
export interface FileTicket {
  /** Tenant. */
  readonly t: string;
  /** Khoá object trong kho ngoài. */
  readonly k: string;
  readonly o: 'get' | 'put';
  /** Hết hạn, giây Unix. */
  readonly e: number;
  /** Kiểu tệp: kiểu lưu khi ghi, kiểu trả về khi đọc. */
  readonly c?: string;
  /** Tên tệp cho `Content-Disposition`. */
  readonly n?: string;
  readonly d?: 'inline' | 'attachment';
  /** Ghi tối đa ngần này byte; với NAS là đúng số byte của tệp. */
  readonly m?: number;
  /** Nguồn: trống là kho ngoài S3 của tenant; `nas` là thư mục chia sẻ của NAS (`k` là đường dẫn trên NAS). */
  readonly p?: 'nas';
}

/**
 * Bí mật của kho ngoài: mã hoá khoá truy cập của tenant trước khi ghi DB, ký và
 * kiểm phiếu chuyển tiếp tệp. Hai khoá con tách từ một khoá gốc bằng HKDF, nên lộ
 * chữ ký phiếu không giúp giải mã khoá kho và ngược lại.
 */
export class StorageSecrets {
  private constructor(
    private readonly encryptionKey: Buffer,
    private readonly ticketKey: Buffer,
  ) {}

  /** `undefined` khi chưa đặt khoá gốc, hoặc khoá quá ngắn. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): StorageSecrets | undefined {
    const secret = env[STORAGE_SECRET_ENV]?.trim();
    if (!secret || secret.length < MIN_SECRET_LENGTH) return undefined;
    return StorageSecrets.fromSecret(secret);
  }

  static fromSecret(secret: string): StorageSecrets {
    const derive = (info: string) =>
      Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), info, 32));
    return new StorageSecrets(derive('shared-storage/credentials'), derive('shared-storage/file-ticket'));
  }

  /** AES-256-GCM: `v1.<iv>.<tag>.<bản mã>`, base64url. */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [CIPHER_PREFIX, iv, cipher.getAuthTag(), body].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
  }

  /** Ném lỗi khi bản mã hỏng hoặc mã bằng khoá gốc khác. */
  decrypt(token: string): string {
    const [prefix, iv, tag, body] = token.split('.');
    if (prefix !== CIPHER_PREFIX || !iv || !tag || body === undefined) throw new Error('Bản mã không đúng định dạng.');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  }

  /** `<nội dung>.<chữ ký>`, cả hai base64url, đặt thẳng vào đường dẫn URL được. */
  signTicket(ticket: FileTicket): string {
    const payload = Buffer.from(JSON.stringify(ticket), 'utf8').toString('base64url');
    return `${payload}.${this.signature(payload)}`;
  }

  /** Phiếu đúng chữ ký, còn hạn, đúng thao tác; ngược lại `undefined`. */
  verifyTicket(token: string, operation: FileTicket['o'], nowMs = Date.now()): FileTicket | undefined {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return undefined;
    const expected = Buffer.from(this.signature(payload), 'base64url');
    const presented = Buffer.from(signature, 'base64url');
    if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) return undefined;
    let ticket: FileTicket;
    try {
      ticket = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as FileTicket;
    } catch {
      return undefined;
    }
    if (
      typeof ticket?.t !== 'string' ||
      typeof ticket.k !== 'string' ||
      ticket.o !== operation ||
      typeof ticket.e !== 'number' ||
      ticket.e * 1000 < nowMs
    ) {
      return undefined;
    }
    return ticket;
  }

  private signature(payload: string): string {
    return createHmac('sha256', this.ticketKey).update(payload).digest('base64url');
  }
}

/** Tenant của một phiếu, để guard mở đúng DB trước khi controller đọc cấu hình kho. */
export function ticketTenant(secrets: StorageSecrets | undefined, token: string, operation: FileTicket['o']): string | undefined {
  return secrets?.verifyTicket(token, operation)?.t;
}
