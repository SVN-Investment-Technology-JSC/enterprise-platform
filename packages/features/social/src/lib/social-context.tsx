'use client';

import type { SocialMe, SocialPost, SocialTopic } from '@enterprise-platform/contracts-social';
import { createContext, useContext } from 'react';

/** Bài vừa lưu từ hộp thoại soạn bài; `seq` tăng mỗi lần để danh sách biết mà nạp lại hoặc thay bài. */
export interface SocialSavedPost {
  readonly seq: number;
  readonly post: SocialPost;
  readonly edited: boolean;
}

/** Phần hộp thoại soạn bài mở sẵn khi bấm lối tắt ở ô đăng bài. */
export type SocialComposerMode = 'media' | 'poll' | 'announcement';

export interface SocialComposerOptions {
  readonly groupId?: string;
  readonly mode?: SocialComposerMode;
}

/**
 * Ngữ cảnh do `SocialScreen` cung cấp cho các view con (bảng tin, nhóm, hồ sơ, tìm kiếm...):
 * người dùng, chuyên mục, mở hộp soạn bài, báo lỗi nhẹ. View nào cần thì đọc bằng `useSocialSession()`
 * thay vì nhận qua props, để chữ ký các view giữ gọn.
 */
export interface SocialSession {
  readonly me: SocialMe;
  readonly topics: readonly SocialTopic[];
  /** Mở hộp thoại soạn bài; truyền bài để sửa, hoặc `groupId` để chọn sẵn nhóm làm nơi đăng. */
  readonly openComposer: (post?: SocialPost, options?: SocialComposerOptions) => void;
  /** Hiện thông báo lỗi/nhắc nhẹ trên đầu màn hình. */
  readonly notify: (message: string) => void;
  /** Lọc theo chuyên mục (chuyển sang `/feed/<id>`). */
  readonly openTopic: (topicId: string) => void;
  readonly saved?: SocialSavedPost;
}

export const SocialSessionContext = createContext<SocialSession | undefined>(undefined);

export const useSocialSession = () => useContext(SocialSessionContext);
