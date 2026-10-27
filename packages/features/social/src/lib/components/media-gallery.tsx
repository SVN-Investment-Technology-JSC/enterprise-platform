'use client';

import type { SocialAttachment, SocialMediaLayout } from '@enterprise-platform/contracts-social';
import { ChevronLeft, ChevronRight, LoaderCircle, Play, TriangleAlert } from 'lucide-react';
import { useCallback, useRef, useState, type CSSProperties } from 'react';
import styles from '../media-gallery.module.scss';
import { useVideoRefreshPoll } from '../use-video-refresh-poll';
import { useNearViewport } from '../use-viewport-visibility';
import { ImageGrid } from './image-grid';
import { MediaViewer } from './media-viewer';
import {
  formatVideoDuration,
  VIDEO_FAILED_MESSAGE,
  VIDEO_NOT_READY_MESSAGE,
  VIDEO_PROCESSING_MESSAGE,
  VideoAttachment,
} from './video-attachment';

/** Một ảnh hoặc video trong bộ ảnh của bài viết (hoặc bản xem trước trong ô soạn). */
export interface GalleryItem {
  readonly key: string;
  readonly kind: 'image' | 'video';
  /** Mô tả ngắn (tên tệp) cho trình đọc màn hình. */
  readonly alt: string;
  /** Ảnh: URL ảnh. Video: URL phát (chỉ khi sẵn sàng, hoặc tệp tạm trong máy khi xem trước trong ô soạn). */
  readonly url?: string;
  readonly posterUrl?: string;
  readonly durationMs?: number;
  readonly width?: number;
  readonly height?: number;
  /** Chỉ video: trạng thái xử lý (thiếu nghĩa là sẵn sàng). */
  readonly processingStatus?: SocialAttachment['processingStatus'];
  readonly processingError?: string;
  /** Bản đầy đủ của tệp (chỉ khi hiển thị bài đã đăng), để dùng lại `VideoAttachment`. */
  readonly attachment?: SocialAttachment;
}

export interface MediaGalleryProps {
  /** Đã theo đúng thứ tự hiển thị. */
  readonly items: readonly GalleryItem[];
  readonly layout: SocialMediaLayout;
  /**
   * Xem trước trong ô soạn: hiển thị tĩnh đúng như khi đăng nhưng không mở trình xem lớn và không phát video thật
   * (ô video hiện ảnh bìa hoặc khung đầu cùng biểu tượng phát; video chưa xong hiện khung "Đang xử lý").
   */
  readonly preview?: boolean;
  /** Bài đã đăng có video chưa xong: gọi để tải lại bài và lấy URL khi xong. */
  readonly onRequestRefresh?: (options?: { readonly silent?: boolean }) => void | Promise<void>;
  readonly className?: string;
}

/** Số ô tối đa của lưới đều và bố cục nổi bật (kể cả ô "+N"). */
export const GALLERY_MAX_TILES = 4;
/** Số video tối đa hiển thị ở bố cục tự động (giữ đúng cách hiển thị cũ của bài). */
const AUTO_MAX_VIDEOS = 3;

export interface GalleryPlan {
  readonly layout: SocialMediaLayout;
  /** Số ô hiển thị. */
  readonly shown: number;
  /** Chỉ số ô lớn (nổi bật), null nếu bố cục không có ô lớn. */
  readonly largeIndex: number | null;
  /** Chỉ số ô phủ "+N", null nếu không có. */
  readonly moreIndex: number | null;
  /** N của "+N" (số mục bị ẩn). */
  readonly more: number;
  /** Số cột của lưới đều (1 khi chỉ có một mục). */
  readonly columns: number;
}

/** Kế hoạch bố cục theo số mục: bao nhiêu ô hiện, ô nào lớn, ô nào phủ "+N". */
export function galleryPlan(layout: SocialMediaLayout, count: number): GalleryPlan {
  const total = Math.max(0, Math.floor(count));
  const capped = layout === 'grid' || layout === 'featured';
  const shown = capped ? Math.min(total, GALLERY_MAX_TILES) : total;
  const more = capped ? total - shown : 0;
  return {
    layout,
    shown,
    largeIndex: layout === 'featured' && shown > 0 ? 0 : null,
    moreIndex: more > 0 ? shown - 1 : null,
    more,
    columns: layout === 'grid' ? (total <= 1 ? 1 : 2) : 1,
  };
}

/** Ảnh và video của một bài (theo thứ tự `attachments`), bỏ các tệp khác. */
export function galleryItemsFromAttachments(attachments: readonly SocialAttachment[]): GalleryItem[] {
  const items: GalleryItem[] = [];
  for (const attachment of attachments) {
    if (attachment.isVideo) {
      items.push({
        key: attachment.id,
        kind: 'video',
        alt: attachment.fileName,
        url: attachment.url,
        posterUrl: attachment.posterUrl,
        durationMs: attachment.durationMs,
        width: attachment.width,
        height: attachment.height,
        processingStatus: attachment.processingStatus,
        processingError: attachment.processingError,
        attachment,
      });
    } else if (attachment.isImage) {
      items.push({
        key: attachment.id,
        kind: 'image',
        alt: attachment.fileName,
        url: attachment.url,
        width: attachment.width,
        height: attachment.height,
      });
    }
  }
  return items;
}

/** Tỉ lệ khung ảnh đơn: dọc nhất 4:5, ngang nhất 1.91:1 (ngoài khoảng thì ảnh nằm trong khung có dải nền, không cắt). */
export const SINGLE_IMAGE_MIN_RATIO = 4 / 5;
export const SINGLE_IMAGE_MAX_RATIO = 1.91;

/**
 * Khung của ảnh đơn theo kích thước thật, kẹp trong [4/5, 1.91]. Thiếu hoặc không hợp lệ (ảnh cũ chưa lưu kích thước)
 * thì không có `aspectRatio`: ảnh hiển thị theo luồng tự nhiên.
 */
export function singleImageFrame(width?: number, height?: number): { aspectRatio?: string } {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return {};
  const ratio = Math.min(SINGLE_IMAGE_MAX_RATIO, Math.max(SINGLE_IMAGE_MIN_RATIO, width / height));
  return { aspectRatio: String(Number(ratio.toFixed(4))) };
}

/** Một ảnh duy nhất của bài: theo tỉ lệ thật, không cắt (`contain` trên nền trung tính). */
function SingleImage({ item, preview, onOpen }: { readonly item: GalleryItem; readonly preview?: boolean; readonly onOpen: () => void }) {
  const ratio = singleImageFrame(item.width, item.height);
  const sized = ratio.aspectRatio !== undefined;
  // `--frame-ratio` để CSS thu hẹp bề ngang khung theo chiều cao tối đa, giữ đúng tỉ lệ (ảnh dọc không ra khung rộng).
  const frame = (sized ? { ...ratio, '--frame-ratio': ratio.aspectRatio } : ratio) as CSSProperties;
  const classes = [styles.singleImage, sized ? styles.singleImageSized : styles.singleImageFlow, preview ? styles.cellStatic : '']
    .filter(Boolean)
    .join(' ');
  const img = item.url ? <img src={item.url} alt={item.alt} loading="lazy" /> : null;
  if (preview) {
    return (
      <div className={classes} style={frame} data-sized={sized}>
        {img}
      </div>
    );
  }
  return (
    <button type="button" className={classes} style={frame} data-sized={sized} aria-label={cellLabel(item)} onClick={onOpen}>
      {img}
    </button>
  );
}

/* ------------------------------------------------------------------ ô nhỏ */

type VideoReadiness = 'processing' | 'failed' | 'ready';

function readiness(item: GalleryItem): VideoReadiness {
  if (item.processingStatus === 'failed') return 'failed';
  if (!item.url) return 'processing';
  return 'ready';
}

function isWaiting(item: GalleryItem): boolean {
  return (
    item.kind === 'video' && !item.url && (item.processingStatus === 'queued' || item.processingStatus === 'processing')
  );
}

function VideoStateBox({ item }: { readonly item: GalleryItem }) {
  const state = readiness(item);
  const waiting = isWaiting(item);
  const text = waiting ? 'Đang xử lý' : state === 'failed' ? VIDEO_FAILED_MESSAGE : VIDEO_NOT_READY_MESSAGE;
  return (
    <div
      className={styles.state}
      role={state === 'failed' ? 'alert' : 'status'}
      aria-label={waiting ? VIDEO_PROCESSING_MESSAGE : text}
      data-state={state}
    >
      {state === 'failed' ? (
        <TriangleAlert size={20} aria-hidden="true" />
      ) : (
        <LoaderCircle size={20} className={styles.spin} aria-hidden="true" />
      )}
      <span>{text}</span>
      {state === 'failed' && item.processingError ? (
        <span className={styles.stateDetail}>{item.processingError}</span>
      ) : null}
    </div>
  );
}

/** Khung đầu của video không có ảnh bìa: chỉ nạp (siêu dữ liệu) khi ô tới gần vùng nhìn thấy, không nạp cả loạt lúc tải trang. */
function LazyFirstFrame({ url, alt }: { readonly url?: string; readonly alt: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref, true);
  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      {near && url ? <video src={url} preload="metadata" muted playsInline aria-label={`Video ${alt}`} /> : null}
    </div>
  );
}

/** Hình của ô: ảnh, hoặc video (ảnh bìa hoặc khung đầu, biểu tượng phát, thời lượng), hoặc khung trạng thái. */
function CellFace({ item }: { readonly item: GalleryItem }) {
  if (item.kind === 'image') {
    return item.url ? <img src={item.url} alt={item.alt} loading="lazy" /> : null;
  }
  if (readiness(item) !== 'ready') return <VideoStateBox item={item} />;
  const duration = formatVideoDuration(item.durationMs);
  return (
    <>
      {item.posterUrl ? (
        <img src={item.posterUrl} alt={item.alt} loading="lazy" />
      ) : (
        <LazyFirstFrame url={item.url} alt={item.alt} />
      )}
      <span className={styles.playBadge} aria-hidden="true">
        <Play size={20} fill="currentColor" />
      </span>
      {duration ? (
        <span className={styles.duration} aria-label={`Thời lượng ${duration}`}>
          {duration}
        </span>
      ) : null}
    </>
  );
}

function cellLabel(item: GalleryItem): string {
  return item.kind === 'video' ? `Xem video ${item.alt}` : `Xem ảnh ${item.alt}`;
}

function Cell({
  item,
  className,
  more,
  preview,
  onOpen,
}: {
  readonly item: GalleryItem;
  readonly className?: string;
  readonly more?: number;
  readonly preview?: boolean;
  readonly onOpen: () => void;
}) {
  const classes = [styles.cell, item.kind === 'video' ? styles.cellVideo : '', preview ? styles.cellStatic : '', className]
    .filter(Boolean)
    .join(' ');
  const overlay = more && more > 0 ? <span className={styles.more}>+{more}</span> : null;
  if (preview) {
    return (
      <div className={classes}>
        <CellFace item={item} />
        {overlay}
      </div>
    );
  }
  return (
    <button type="button" className={classes} aria-label={cellLabel(item)} onClick={onOpen}>
      <CellFace item={item} />
      {overlay}
    </button>
  );
}

/* ---------------------------------------------------------------- bố cục */

interface LayoutProps {
  readonly items: readonly GalleryItem[];
  readonly preview?: boolean;
  readonly onOpen: (index: number) => void;
  readonly onRequestRefresh?: MediaGalleryProps['onRequestRefresh'];
}

function GridLayout({ items, preview, onOpen }: LayoutProps) {
  const plan = galleryPlan('grid', items.length);
  return (
    <div className={styles.grid} data-count={plan.shown} data-layout="grid">
      {items.slice(0, plan.shown).map((item, index) => (
        <Cell
          key={item.key}
          item={item}
          preview={preview}
          more={index === plan.moreIndex ? plan.more : undefined}
          onOpen={() => onOpen(index)}
        />
      ))}
    </div>
  );
}

function FeaturedLayout({ items, preview, onOpen }: LayoutProps) {
  const plan = galleryPlan('featured', items.length);
  return (
    <div className={styles.featured} data-count={plan.shown} data-layout="featured">
      {items.slice(0, plan.shown).map((item, index) => (
        <Cell
          key={item.key}
          item={item}
          preview={preview}
          className={index === plan.largeIndex ? styles.featuredMain : styles.cellSmall}
          more={index === plan.moreIndex ? plan.more : undefined}
          onOpen={() => onOpen(index)}
        />
      ))}
    </div>
  );
}

/** Video phát tại chỗ khi có bản đầy đủ của tệp (bài đã đăng); thiếu thì dùng ô tĩnh. */
function InlineVideo({ item, onRequestRefresh }: { readonly item: GalleryItem; readonly onRequestRefresh?: MediaGalleryProps['onRequestRefresh'] }) {
  if (!item.attachment) return null;
  return <VideoAttachment attachment={item.attachment} className={styles.fullVideo} onRequestRefresh={onRequestRefresh} />;
}

function StackLayout({ items, preview, onOpen, onRequestRefresh }: LayoutProps) {
  return (
    <div className={styles.stack} data-layout="stack">
      {items.map((item, index) => {
        if (item.kind === 'video') {
          return !preview && item.attachment ? (
            <InlineVideo key={item.key} item={item} onRequestRefresh={onRequestRefresh} />
          ) : (
            <Cell key={item.key} item={item} preview className={styles.featuredMain} onOpen={() => onOpen(index)} />
          );
        }
        const image = item.url ? <img src={item.url} alt={item.alt} loading="lazy" /> : null;
        return preview ? (
          <div key={item.key} className={styles.stackImage}>
            {image}
          </div>
        ) : (
          <button
            key={item.key}
            type="button"
            className={styles.stackImage}
            aria-label={cellLabel(item)}
            onClick={() => onOpen(index)}
          >
            {image}
          </button>
        );
      })}
    </div>
  );
}

function CarouselLayout({ items, preview, onOpen, onRequestRefresh }: LayoutProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const count = items.length;

  const goTo = useCallback((next: number) => {
    const track = trackRef.current;
    const slide = track?.children[next] as HTMLElement | undefined;
    if (!track || !slide) return;
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const left = slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2;
    if (typeof track.scrollTo === 'function') track.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' });
    setActive(next);
  }, []);

  const onScroll = () => {
    const track = trackRef.current;
    const first = track?.children[0] as HTMLElement | undefined;
    if (!track || !first || first.offsetWidth === 0) return;
    const step = first.offsetWidth + 8;
    setActive(Math.min(count - 1, Math.max(0, Math.round(track.scrollLeft / step))));
  };

  return (
    <div className={styles.carousel} data-layout="carousel">
      <div
        ref={trackRef}
        className={styles.track}
        role="group"
        aria-roledescription="băng chuyền"
        aria-label="Ảnh và video của bài"
        onScroll={onScroll}
      >
        {items.map((item, index) => (
          <div
            key={item.key}
            className={styles.slide}
            data-single={count === 1}
            role="group"
            aria-roledescription="trang"
            aria-label={`${index + 1} trên ${count}`}
          >
            {item.kind === 'video' && !preview && item.attachment ? (
              <InlineVideo item={item} onRequestRefresh={onRequestRefresh} />
            ) : (
              <Cell item={item} preview={preview} onOpen={() => onOpen(index)} />
            )}
          </div>
        ))}
      </div>
      {count > 1 ? (
        <>
          <span className={styles.carouselCount} aria-live="polite">
            {active + 1}/{count}
          </span>
          {active > 0 ? (
            <button
              type="button"
              className={`${styles.carouselNav} ${styles.carouselPrev}`}
              aria-label="Mục trước"
              onClick={() => goTo(active - 1)}
            >
              <ChevronLeft size={20} />
            </button>
          ) : null}
          {active < count - 1 ? (
            <button
              type="button"
              className={`${styles.carouselNav} ${styles.carouselNext}`}
              aria-label="Mục sau"
              onClick={() => goTo(active + 1)}
            >
              <ChevronRight size={20} />
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Bố cục cũ: ảnh dạng lưới (ImageGrid), video xếp dọc phía dưới; giữ nguyên để bài cũ không đổi. */
function AutoLayout({ items, preview, onRequestRefresh }: LayoutProps) {
  const images: SocialAttachment[] = items
    .filter((item) => item.kind === 'image')
    .map((item) => ({
      id: item.key,
      fileName: item.alt,
      contentType: 'image/*',
      sizeBytes: 0,
      isImage: true,
      isVideo: false,
      url: item.url,
    }));
  const videos = items.filter((item) => item.kind === 'video').slice(0, AUTO_MAX_VIDEOS);
  return (
    <div className={styles.autoStack} data-layout="auto">
      {images.length > 0 ? <ImageGrid images={images} preview={preview} /> : null}
      {videos.map((item) =>
        !preview && item.attachment ? (
          <VideoAttachment key={item.key} attachment={item.attachment} fit onRequestRefresh={onRequestRefresh} />
        ) : (
          <div key={item.key} className={styles.stack}>
            <Cell item={item} preview className={styles.featuredMain} onOpen={() => undefined} />
          </div>
        ),
      )}
    </div>
  );
}

/**
 * Hiển thị ảnh và video của bài (hoặc bản xem trước trong ô soạn) theo bố cục tác giả chọn.
 * `auto` giữ cách hiển thị cũ; các bố cục còn lại mở `MediaViewer` khi bấm vào ảnh hoặc ô video.
 */
export function MediaGallery({ items, layout, preview = false, onRequestRefresh, className }: MediaGalleryProps) {
  const [viewing, setViewing] = useState<number>();
  // Lưới và nổi bật không dùng VideoAttachment nên tự làm mới ở đây; các bố cục khác để VideoAttachment lo.
  const ownsRefresh = !preview && (layout === 'grid' || layout === 'featured');
  useVideoRefreshPoll(ownsRefresh && items.some(isWaiting), onRequestRefresh);

  if (items.length === 0) return null;
  const onOpen = preview ? () => undefined : setViewing;
  const refresh = preview ? undefined : onRequestRefresh;
  const common: LayoutProps = { items, preview, onOpen, onRequestRefresh: refresh };
  // Đúng một ảnh: mọi bố cục đều hiển thị theo tỉ lệ thật, không cắt. Ảnh kèm video hay nhiều mục giữ ô cắt đều.
  const single = items.length === 1 && items[0].kind === 'image' ? items[0] : undefined;

  return (
    <div className={[styles.gallery, className].filter(Boolean).join(' ')}>
      {single ? (
        <SingleImage item={single} preview={preview} onOpen={() => onOpen(0)} />
      ) : layout === 'grid' ? (
        <GridLayout {...common} />
      ) : layout === 'featured' ? (
        <FeaturedLayout {...common} />
      ) : layout === 'stack' ? (
        <StackLayout {...common} />
      ) : layout === 'carousel' ? (
        <CarouselLayout {...common} />
      ) : (
        <AutoLayout {...common} />
      )}
      {!preview && viewing !== undefined ? (
        <MediaViewer items={items} index={viewing} onIndex={setViewing} onClose={() => setViewing(undefined)} />
      ) : null}
    </div>
  );
}
