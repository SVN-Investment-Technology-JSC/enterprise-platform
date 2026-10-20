import {
  ObjectNotFoundError,
  ObjectTooLargeError,
  type ObjectStorageManagementPort,
  type ObjectStorageReadPort,
} from '@enterprise-platform/adapter-storage';
import { Logger } from '@nestjs/common';
import { brandErrors } from './brand.errors.js';

export interface BrandObjectContent {
  readonly text: string;
  readonly sizeBytes: number;
}

/**
 * Cổng kho object mà Brand Studio cần. Lỗi kho đã được đổi thành `BrandError` (503 khi kho không dùng được,
 * 502 khi object quá lớn bất thường), nên tầng trên không phụ thuộc AWS SDK.
 */
export interface BrandObjectStore {
  put(key: string, contentType: string, body: string): Promise<void>;
  /** Null khi khoá không có trong kho. */
  get(key: string, maxBytes: number): Promise<BrandObjectContent | null>;
  /** Cố gắng xoá; trả về các khoá kho từ chối xoá. */
  remove(
    keys: readonly string[],
  ): Promise<{ readonly failed: readonly string[] }>;
}

export type BrandStorageClient = ObjectStorageManagementPort &
  ObjectStorageReadPort;

const decoder = new TextDecoder('utf-8');
const logger = new Logger('BrandObjectStore');

function describe(error: unknown): string {
  const name = (error as { name?: string })?.name ?? 'Error';
  const message = (error as { message?: string })?.message ?? '';
  return `${name}: ${message}`;
}

export function createS3BrandObjectStore(
  storage: BrandStorageClient,
): BrandObjectStore {
  return {
    async put(key, contentType, body) {
      try {
        await storage.putObject({ key, contentType, body });
      } catch (error) {
        logger.error(`Không ghi được object ${key}: ${describe(error)}`);
        throw brandErrors.storageUnavailable();
      }
    },
    async get(key, maxBytes) {
      try {
        const content = await storage.getObject(key, { maxBytes });
        return {
          text: decoder.decode(content.body),
          sizeBytes: content.sizeBytes,
        };
      } catch (error) {
        if (error instanceof ObjectNotFoundError) return null;
        if (error instanceof ObjectTooLargeError) {
          logger.error(`Object ${key} lớn bất thường: ${describe(error)}`);
          throw brandErrors.storageCorrupt();
        }
        logger.error(`Không đọc được object ${key}: ${describe(error)}`);
        throw brandErrors.storageUnavailable();
      }
    },
    remove: (keys) =>
      keys.length === 0
        ? Promise.resolve({ failed: [] })
        : storage.deleteObjects(keys),
  };
}
