import {
  SOCIAL_MEDIA_LAYOUT_DEFAULT,
  type SocialAttachment,
  type SocialMediaLayout,
} from '@enterprise-platform/contracts-social';
import type { GalleryItem } from './components/media-gallery';

/** Phần của một tệp trong ô soạn bài mà việc sắp thứ tự, dựng id và dựng bản xem trước cần. */
export interface ComposerMediaFile {
  readonly key: string;
  readonly fileName: string;
  readonly isImage: boolean;
  readonly isVideo?: boolean;
  readonly status: 'uploading' | 'done' | 'error';
  readonly attachment?: SocialAttachment;
  /** URL tạm trong máy của tệp vừa chọn. */
  readonly objectUrl?: string;
}

/** Ảnh hoặc video (được sắp thứ tự và xếp bố cục); tài liệu thì không. */
export const isMediaFile = (file: Pick<ComposerMediaFile, 'isImage' | 'isVideo'>): boolean =>
  file.isImage || file.isVideo === true;

/** Tệp có còn hiện trong bố cục không: loại tệp lỗi tải và video xử lý lỗi. */
const isVisibleMedia = (file: ComposerMediaFile): boolean =>
  isMediaFile(file) && file.status !== 'error' && file.attachment?.processingStatus !== 'failed';

/** Số ảnh và video đang có trong bài (không tính tệp lỗi): từ 2 trở lên mới cần chọn bố cục. */
export const countLayoutMedia = (files: readonly ComposerMediaFile[]): number => files.filter(isVisibleMedia).length;

/**
 * Mã tệp gửi lên server: ảnh và video theo thứ tự đang sắp, rồi tới tài liệu. Chỉ gồm tệp đã tải xong và không
 * lỗi xử lý (video đang `queued`/`processing` vẫn gửi); tệp đang tải bị bỏ, thứ tự các tệp còn lại giữ nguyên.
 */
export function orderedAttachmentIds(files: readonly ComposerMediaFile[]): string[] {
  const ids = (list: readonly ComposerMediaFile[]) =>
    list.flatMap((file) =>
      file.status === 'done' && file.attachment && file.attachment.processingStatus !== 'failed'
        ? [file.attachment.id]
        : [],
    );
  return [...ids(files.filter(isMediaFile)), ...ids(files.filter((file) => !isMediaFile(file)))];
}

/** Phần bố cục của yêu cầu đăng hoặc sửa bài. */
export function buildMediaPayload(
  files: readonly ComposerMediaFile[],
  layout: SocialMediaLayout | undefined,
): { readonly attachmentIds: string[]; readonly mediaLayout: SocialMediaLayout } {
  return {
    attachmentIds: orderedAttachmentIds(files),
    mediaLayout: layout ?? SOCIAL_MEDIA_LAYOUT_DEFAULT,
  };
}

export type MoveDirection = 'earlier' | 'later';

/**
 * Đổi chỗ một ảnh hoặc video với ảnh hoặc video kề nó (bỏ qua tài liệu nằm giữa). Không vượt biên: đã ở đầu hoặc
 * cuối thì trả đúng danh sách cũ. Tài liệu và các mục khác giữ nguyên vị trí.
 */
export function moveItem<T extends Pick<ComposerMediaFile, 'key' | 'isImage' | 'isVideo'>>(
  list: readonly T[],
  key: string,
  direction: MoveDirection,
): readonly T[] {
  const from = list.findIndex((item) => item.key === key);
  if (from < 0 || !isMediaFile(list[from])) return list;
  const step = direction === 'earlier' ? -1 : 1;
  let to = from + step;
  while (to >= 0 && to < list.length && !isMediaFile(list[to])) to += step;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Ảnh hoặc video này có đổi chỗ được lên trước / ra sau không (để tắt nút ở đầu và cuối). */
export function canMoveItem(
  list: readonly Pick<ComposerMediaFile, 'key' | 'isImage' | 'isVideo'>[],
  key: string,
  direction: MoveDirection,
): boolean {
  return moveItem(list, key, direction) !== list;
}

/**
 * Dựng các mục cho bản xem trước bố cục từ danh sách tệp trong ô soạn (đúng thứ tự đang sắp). Bỏ tài liệu, tệp
 * lỗi tải và video xử lý lỗi. Ảnh: URL của máy chủ khi đã tải xong, ngược lại URL tạm trong máy. Video: poster và
 * URL phát khi sẵn sàng; chưa xong thì chỉ có URL tạm (khung đầu) cùng trạng thái xử lý.
 */
export function buildGalleryItems(files: readonly ComposerMediaFile[]): GalleryItem[] {
  return files.filter(isVisibleMedia).map((file): GalleryItem => {
    const { attachment } = file;
    if (!file.isVideo) {
      return {
        key: file.key,
        kind: 'image',
        alt: file.fileName,
        url: attachment?.url ?? file.objectUrl,
        width: attachment?.width,
        height: attachment?.height,
      };
    }
    const status = file.status === 'uploading' ? 'processing' : (attachment?.processingStatus ?? 'ready');
    const ready = status === 'ready';
    return {
      key: file.key,
      kind: 'video',
      alt: file.fileName,
      url: ready ? (attachment?.url ?? file.objectUrl) : file.objectUrl,
      posterUrl: ready ? attachment?.posterUrl : undefined,
      durationMs: attachment?.durationMs,
      width: attachment?.width,
      height: attachment?.height,
      processingStatus: ready ? undefined : status,
      processingError: attachment?.processingError,
    };
  });
}
