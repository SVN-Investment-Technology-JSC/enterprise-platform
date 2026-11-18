'use client';

/**
 * `QuoteLayoutView`: nơi duy nhất quyết định hình thức bản in báo giá (plan mục 9.2). Trình thiết kế (`design`), khung xem
 * trước (`preview`) và bản in PDF (`print`) đều dựng bằng component này nên luôn giống nhau.
 *
 * - Trang dựng theo mm (A4 210×297, A3 297×420; ngang thì đảo), rồi `transform: scale()` cho vừa bề ngang khung
 *   (`design`, `preview`). `print` không thu phóng, không có lề trong: lề do `@page` của bản in quyết định.
 * - Nội dung dài hơn một trang: trang dài liên tục, vẽ vạch ngắt trang ước lượng (`design`, `preview`).
 * - Không có `dangerouslySetInnerHTML`; mọi chữ là chữ thuần.
 */
import type { QuoteLayout, QuoteLayoutBlock, QuoteLayoutFont } from '@enterprise-platform/contracts-crm';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { QUOTE_LAYOUT_BLOCK_LABELS, QuoteLayoutBlockContent, type QuoteLayoutViewMode } from './quote-layout-blocks';
import type { QuoteLayoutData } from './quote-layout.data';
import styles from './quote-layout.module.scss';

export type { QuoteLayoutViewMode } from './quote-layout-blocks';

const PAPER_MM = { A4: { width: 210, height: 297 }, A3: { width: 297, height: 420 } } as const;
const MM_TO_PX = 96 / 25.4;

/** Kích thước trang (mm) theo khổ và hướng. */
export function quoteLayoutPageSize(layout: Pick<QuoteLayout, 'paper' | 'orientation'>): { width: number; height: number } {
  const paper = PAPER_MM[layout.paper] ?? PAPER_MM.A4;
  return layout.orientation === 'landscape' ? { width: paper.height, height: paper.width } : { ...paper };
}

const FONT_STACKS: Readonly<Record<QuoteLayoutFont, string>> = {
  'Times New Roman': '"Times New Roman", Times, serif',
  Arial: 'Arial, Helvetica, sans-serif',
  Roboto: 'Roboto, Arial, sans-serif',
};

/** Chuỗi font CSS cho font của bố cục. */
export function quoteLayoutFontStack(font: QuoteLayoutFont): string {
  return FONT_STACKS[font] ?? FONT_STACKS['Times New Roman'];
}

/** Luật `@page` cho bản in: khổ, hướng, lề theo bố cục. */
export function quoteLayoutPageCss(layout: Pick<QuoteLayout, 'paper' | 'orientation' | 'marginsMm'>): string {
  const { top, right, bottom, left } = layout.marginsMm;
  return `@page { size: ${layout.paper} ${layout.orientation}; margin: ${top}mm ${right}mm ${bottom}mm ${left}mm; }`;
}

/**
 * Vị trí (mm, tính từ mép trên trang dài) của các vạch ngắt trang ước lượng: mỗi trang chứa được chiều cao trang trừ lề
 * trên và lề dưới.
 */
export function estimatePageBreaks(contentHeightMm: number, layout: Pick<QuoteLayout, 'paper' | 'orientation' | 'marginsMm'>): number[] {
  const page = quoteLayoutPageSize(layout);
  const usable = page.height - layout.marginsMm.top - layout.marginsMm.bottom;
  if (usable <= 0) return [];
  const body = contentHeightMm - layout.marginsMm.top - layout.marginsMm.bottom;
  const breaks: number[] = [];
  for (let count = 1; count * usable < body - 0.5 && breaks.length < 500; count += 1) breaks.push(layout.marginsMm.top + count * usable);
  return breaks;
}

export interface QuoteLayoutBlockChromeInfo {
  readonly index: number;
  readonly selected: boolean;
}

export interface QuoteLayoutViewProps {
  readonly layout: QuoteLayout;
  readonly data: QuoteLayoutData;
  /**
   * - `design`: khối bấm chọn được, khối đang chọn có viền, biến hiện thành chip, vạch ngắt trang.
   * - `preview`: chữ đã thay biến, vạch ngắt trang, bảng hàng rỗng có dòng "Chưa có dòng hàng".
   * - `print`: không thu phóng, không lề trong (lề do `@page`), bảng hàng rỗng chỉ có tiêu đề.
   */
  readonly mode: QuoteLayoutViewMode;
  /** `design`: id khối đang chọn. */
  readonly selectedId?: string | null;
  /** `design`: bấm khối gọi với id khối; bấm vùng trống của trang gọi với `null`. */
  readonly onSelect?: (blockId: string | null) => void;
  /** `design`: phần thêm vào trong khung mỗi khối (thanh công cụ lên, xuống, xoá...). */
  readonly renderBlockChrome?: (block: QuoteLayoutBlock, info: QuoteLayoutBlockChromeInfo) => ReactNode;
  /** `design`: thuộc tính thêm cho khung mỗi khối (ví dụ `draggable`, `onDragStart`, `onDrop`). */
  readonly blockProps?: (block: QuoteLayoutBlock, index: number) => HTMLAttributes<HTMLDivElement>;
  /** `design`, `preview`: tỉ lệ thu phóng lớn nhất khi khung rộng hơn trang (mặc định 1). */
  readonly maxScale?: number;
  readonly className?: string;
}

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

/** Bề ngang phần tử, theo dõi bằng `ResizeObserver`; `key` đổi thì gắn lại (phần tử có thể mới xuất hiện). */
function useElementWidth<T extends HTMLElement>(key: unknown): [RefObject<T | null>, number | null] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    setWidth(element.clientWidth || null);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth || null));
    observer.observe(element);
    return () => observer.disconnect();
  }, [key]);
  return [ref, width];
}

/** Chiều cao phần tử (không tính `transform`), theo dõi bằng `ResizeObserver`. */
function useElementHeight<T extends HTMLElement>(key: unknown): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    setHeight(element.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [key]);
  return [ref, height];
}

function BlockFrame({
  block,
  index,
  mode,
  data,
  selected,
  onSelect,
  renderBlockChrome,
  blockProps,
}: {
  block: QuoteLayoutBlock;
  index: number;
  mode: QuoteLayoutViewMode;
  data: QuoteLayoutData;
  selected: boolean;
  onSelect?: (blockId: string | null) => void;
  renderBlockChrome?: QuoteLayoutViewProps['renderBlockChrome'];
  blockProps?: QuoteLayoutViewProps['blockProps'];
}) {
  const style: CSSProperties | undefined = block.marginTopMm ? { marginTop: `${block.marginTopMm}mm` } : undefined;
  const content = <QuoteLayoutBlockContent block={block} mode={mode} data={data} />;
  const className = cx(styles.block, styles[`block_${block.type}`]);
  if (mode !== 'design') {
    return (
      <div className={className} style={style} data-block-id={block.id} data-block-type={block.type}>
        {content}
      </div>
    );
  }
  const extra = blockProps?.(block, index) ?? {};
  const select = () => onSelect?.(block.id);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    extra.onKeyDown?.(event);
    if (event.defaultPrevented || event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select();
    }
  };
  return (
    <div
      {...extra}
      className={cx(className, styles.blockDesign, block.type === 'divider' && styles.blockHitArea, selected && styles.blockSelected, extra.className)}
      style={{ ...style, ...extra.style }}
      data-block-id={block.id}
      data-block-type={block.type}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${QUOTE_LAYOUT_BLOCK_LABELS[block.type]} ${index + 1}`}
      onClick={(event) => {
        extra.onClick?.(event);
        event.stopPropagation();
        select();
      }}
      onKeyDown={onKeyDown}
    >
      {content}
      {renderBlockChrome?.(block, { index, selected })}
    </div>
  );
}

/**
 * Dựng bố cục in với dữ liệu. Xem `QuoteLayoutViewProps` cho từng chế độ. Ở `design` và `preview`, component chiếm hết
 * bề ngang khung cha và tự đặt chiều cao theo trang đã thu phóng.
 */
export function QuoteLayoutView({
  layout,
  data,
  mode,
  selectedId = null,
  onSelect,
  renderBlockChrome,
  blockProps,
  maxScale = 1,
  className,
}: QuoteLayoutViewProps) {
  const page = quoteLayoutPageSize(layout);
  const [viewportRef, viewportWidth] = useElementWidth<HTMLDivElement>(mode);
  const [sheetRef, sheetHeight] = useElementHeight<HTMLDivElement>(mode);
  const typography: CSSProperties = {
    fontFamily: quoteLayoutFontStack(layout.fontFamily),
    fontSize: `${layout.fontSizePt}pt`,
  };
  const blocks = layout.blocks.map((block, index) => (
    <BlockFrame
      key={block.id || index}
      block={block}
      index={index}
      mode={mode}
      data={data}
      selected={mode === 'design' && block.id === selectedId}
      onSelect={onSelect}
      renderBlockChrome={renderBlockChrome}
      blockProps={blockProps}
    />
  ));

  if (mode === 'print') {
    return (
      <div className={cx(styles.sheetPrint, className)} style={typography} data-mode="print">
        {blocks}
      </div>
    );
  }

  const pageWidthPx = page.width * MM_TO_PX;
  const scale = viewportWidth ? Math.min(maxScale, viewportWidth / pageWidthPx) : 1;
  const sheetHeightMm = sheetHeight / MM_TO_PX;
  const breaks = sheetHeight ? estimatePageBreaks(sheetHeightMm, layout) : [];
  const { top, right, bottom, left } = layout.marginsMm;
  const sheetStyle: CSSProperties = {
    ...typography,
    width: `${page.width}mm`,
    minHeight: `${page.height}mm`,
    padding: `${top}mm ${right}mm ${bottom}mm ${left}mm`,
    transform: scale === 1 ? undefined : `scale(${scale})`,
  };

  return (
    <div
      ref={viewportRef}
      className={cx(styles.viewport, className)}
      style={{ height: sheetHeight ? `${sheetHeight * scale}px` : undefined }}
      data-mode={mode}
      data-scale={scale.toFixed(3)}
    >
      <div
        ref={sheetRef}
        className={cx(styles.sheet, mode === 'design' && styles.sheetDesign)}
        style={sheetStyle}
        data-paper={layout.paper}
        data-orientation={layout.orientation}
        onClick={mode === 'design' ? () => onSelect?.(null) : undefined}
      >
        {blocks}
        {breaks.map((at, index) => (
          <div key={at} className={styles.pageBreak} style={{ top: `${at}mm` }} aria-hidden="true">
            <span className={styles.pageBreakLabel}>Trang {index + 2}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
