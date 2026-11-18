'use client';

/**
 * Thư viện khối bên trái của trình thiết kế (plan mục 9.3): kéo khối vào trang, hoặc bấm để thêm ngay dưới khối đang chọn
 * (chưa chọn thì thêm cuối trang).
 */
import { QUOTE_LAYOUT_BLOCK_TYPES, type QuoteLayoutBlockType } from '@enterprise-platform/contracts-crm';
import {
  Building2,
  FileSignature,
  Heading,
  Image as ImageIcon,
  ListChecks,
  Minus,
  MoveVertical,
  Pilcrow,
  Sigma,
  Table2,
  TableProperties,
} from 'lucide-react';
import type { DragEvent, ReactNode } from 'react';
import styles from './layout-designer.module.scss';
import { QUOTE_LAYOUT_BLOCK_LABELS } from './quote-layout-blocks';

/** Kiểu dữ liệu kéo thả khi kéo khối mới từ thư viện. */
export const PALETTE_DRAG_TYPE = 'application/x-quote-layout-block-type';

export const PALETTE_DESCRIPTIONS: Readonly<Record<QuoteLayoutBlockType, string>> = {
  companyHeader: 'Tên, địa chỉ, mã số thuế, logo công ty',
  title: 'Tiêu đề lớn như "BÁO GIÁ", có dòng phụ',
  fieldGrid: 'Các cặp nhãn và giá trị: khách hàng, hiệu lực...',
  text: 'Đoạn văn tự do, có biến',
  lineTable: 'Bảng dòng hàng của báo giá',
  totals: 'Tạm tính, chiết khấu, thuế, tổng cộng, bằng chữ',
  terms: 'Điều khoản thanh toán, giao hàng, ghi chú',
  signature: 'Ô ký bên mua và bên bán',
  image: 'Logo, con dấu hoặc ảnh khác',
  spacer: 'Khoảng trắng giữa hai khối',
  divider: 'Đường kẻ ngang',
};

const ICONS: Readonly<Record<QuoteLayoutBlockType, ReactNode>> = {
  companyHeader: <Building2 size={16} aria-hidden="true" />,
  title: <Heading size={16} aria-hidden="true" />,
  fieldGrid: <TableProperties size={16} aria-hidden="true" />,
  text: <Pilcrow size={16} aria-hidden="true" />,
  lineTable: <Table2 size={16} aria-hidden="true" />,
  totals: <Sigma size={16} aria-hidden="true" />,
  terms: <ListChecks size={16} aria-hidden="true" />,
  signature: <FileSignature size={16} aria-hidden="true" />,
  image: <ImageIcon size={16} aria-hidden="true" />,
  spacer: <MoveVertical size={16} aria-hidden="true" />,
  divider: <Minus size={16} aria-hidden="true" />,
};

/** Thứ tự hiện trong thư viện: theo thứ tự thường gặp trên một bản báo giá. */
const ORDER: readonly QuoteLayoutBlockType[] = [
  'companyHeader',
  'title',
  'fieldGrid',
  'text',
  'lineTable',
  'totals',
  'terms',
  'signature',
  'image',
  'spacer',
  'divider',
];

export interface LayoutPaletteProps {
  readonly onAdd: (type: QuoteLayoutBlockType) => void;
  readonly onDragStart: (type: QuoteLayoutBlockType) => void;
  readonly onDragEnd: () => void;
}

export function LayoutPalette({ onAdd, onDragStart, onDragEnd }: LayoutPaletteProps) {
  const types = ORDER.filter((type) => QUOTE_LAYOUT_BLOCK_TYPES.includes(type));
  const start = (type: QuoteLayoutBlockType) => (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(PALETTE_DRAG_TYPE, type);
    event.dataTransfer.setData('text/plain', QUOTE_LAYOUT_BLOCK_LABELS[type]);
    onDragStart(type);
  };
  return (
    <nav className={styles.palette} aria-label="Thư viện khối">
      <h2 className={styles.paneTitle}>Thư viện khối</h2>
      <p className={styles.paneHint}>Kéo khối vào trang, hoặc bấm để thêm dưới khối đang chọn.</p>
      <ul className={styles.paletteList}>
        {types.map((type) => (
          <li key={type}>
            <button
              type="button"
              className={styles.paletteItem}
              draggable
              aria-label={`Thêm khối ${QUOTE_LAYOUT_BLOCK_LABELS[type]}`}
              onClick={() => onAdd(type)}
              onDragStart={start(type)}
              onDragEnd={onDragEnd}
            >
              <span className={styles.paletteIcon}>{ICONS[type]}</span>
              <span className={styles.paletteText}>
                <strong>{QUOTE_LAYOUT_BLOCK_LABELS[type]}</strong>
                <span>{PALETTE_DESCRIPTIONS[type]}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
