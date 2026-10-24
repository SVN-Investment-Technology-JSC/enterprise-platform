import { randomUUID } from 'node:crypto';
import {
  AVATAR_MAX_UPLOAD_BYTES,
  CORE_USER_AVATAR_UPDATED_EVENT,
  type MyProfile,
  type PeopleDirectory,
} from '@enterprise-platform/contracts-chat';
import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantCoreAccess } from '@enterprise-platform/platform-identity';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { avatarExtension, avatarProblem, detectAvatarImage } from './avatar-image.js';
import {
  listPeople,
  loadAvatar,
  loadProfile,
  replaceAvatar,
  writeOutboxEvent,
  type ProfileDb,
} from './profile.store.js';

/** Phần kho đối tượng mà ảnh đại diện cần (MinIO/S3 qua `adapter-storage`). */
export interface AvatarStorage {
  putObject(input: { readonly key: string; readonly contentType: string; readonly body: Uint8Array }): Promise<void>;
  getObject(key: string, options?: { readonly maxBytes?: number }): Promise<{ readonly body: Uint8Array; readonly contentType: string }>;
  deleteObjects(keys: readonly string[]): Promise<{ readonly failed: readonly string[] }>;
}

/** Pool và giao dịch theo tenant (`TenantCoreAccess` của core). */
export type ProfileDatabases = Pick<TenantCoreAccess, 'pool' | 'transaction'>;

export interface AvatarContent {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly version: number;
}

const PROBLEM_MESSAGES = {
  missing: 'Chưa chọn ảnh.',
  'too-large': `Ảnh sau khi thu nhỏ vượt quá ${Math.round(AVATAR_MAX_UPLOAD_BYTES / 1024)} KB.`,
  unsupported: 'Chỉ nhận ảnh PNG, JPG hoặc WebP.',
} as const;

/**
 * Ảnh đại diện và danh bạ người dùng của công ty: tính năng core, mọi người dùng doanh nghiệp đều dùng được,
 * không phụ thuộc phân hệ nào. Ảnh nằm trong kho đối tượng; DB tenant chỉ giữ khoá và phiên bản.
 */
export class ProfileService {
  constructor(
    private readonly databases: ProfileDatabases,
    private readonly storage: AvatarStorage,
    private readonly newId: () => string = randomUUID,
  ) {}

  async me(principal: TenantUserPrincipal): Promise<MyProfile> {
    const profile = await loadProfile(await this.databases.pool(principal.tenantId), principal.userId);
    if (!profile) throw new NotFoundException('Không tìm thấy tài khoản.');
    return profile;
  }

  async people(principal: TenantUserPrincipal): Promise<PeopleDirectory> {
    return { people: await listPeople(await this.databases.pool(principal.tenantId)) };
  }

  /**
   * Đổi ảnh: ghi ảnh vào kho trước, rồi mới đổi khoá trong DB và phát sự kiện trong cùng một giao dịch. Giao dịch
   * lỗi thì xoá ảnh vừa ghi; thành công thì xoá ảnh cũ. Xoá là cố gắng tốt nhất: còn sót chỉ tốn chỗ, không sai dữ liệu.
   */
  async setAvatar(principal: TenantUserPrincipal, bytes: Uint8Array | undefined): Promise<MyProfile> {
    const problem = avatarProblem(bytes);
    if (problem || !bytes) throw new BadRequestException(PROBLEM_MESSAGES[problem ?? 'missing']);
    const contentType = detectAvatarImage(bytes) as NonNullable<ReturnType<typeof detectAvatarImage>>;
    const key = `tenants/${principal.tenantId}/core/avatars/${principal.userId}/${this.newId()}.${avatarExtension(contentType)}`;
    await this.storage.putObject({ key, contentType, body: bytes });
    let previousKey: string | null;
    try {
      previousKey = await this.databases.transaction(principal.tenantId, async (db) => {
        const result = await replaceAvatar(db, principal.userId, { key, contentType, sizeBytes: bytes.length });
        await this.announce(db, principal);
        return result.previousKey;
      });
    } catch (error) {
      await this.storage.deleteObjects([key]).catch(() => undefined);
      throw error;
    }
    if (previousKey) await this.storage.deleteObjects([previousKey]).catch(() => undefined);
    return this.me(principal);
  }

  async removeAvatar(principal: TenantUserPrincipal): Promise<MyProfile> {
    const previousKey = await this.databases.transaction(principal.tenantId, async (db) => {
      const result = await replaceAvatar(db, principal.userId, null);
      if (result.previousKey) await this.announce(db, principal);
      return result.previousKey;
    });
    if (previousKey) await this.storage.deleteObjects([previousKey]).catch(() => undefined);
    return this.me(principal);
  }

  /** Ảnh của một người cùng công ty; null khi người đó chưa có ảnh hoặc ảnh đã mất khỏi kho. */
  async avatar(principal: TenantUserPrincipal, userId: string): Promise<AvatarContent | null> {
    const stored = await loadAvatar(await this.databases.pool(principal.tenantId), userId);
    if (!stored) return null;
    try {
      const content = await this.storage.getObject(stored.key, { maxBytes: AVATAR_MAX_UPLOAD_BYTES * 2 });
      return { body: content.body, contentType: stored.contentType, version: stored.version };
    } catch {
      return null;
    }
  }

  private async announce(db: ProfileDb, principal: TenantUserPrincipal): Promise<void> {
    const event = createIntegrationEvent({
      id: this.newId(),
      type: CORE_USER_AVATAR_UPDATED_EVENT,
      tenantId: principal.tenantId,
      source: 'platform-profile',
      correlationId: this.newId(),
      payload: { userId: principal.userId },
    });
    await writeOutboxEvent(
      db,
      { id: event.id, type: event.type, aggregateType: 'core-user-profile', aggregateId: principal.userId, occurredAt: event.occurredAt },
      event,
    );
  }
}
