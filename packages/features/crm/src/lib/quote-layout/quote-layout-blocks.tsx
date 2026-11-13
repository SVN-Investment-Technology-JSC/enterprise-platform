'use client';

/**
 * Component dựng từng loại khối của bố cục in (plan mục 5.2). Chỉ dùng qua `QuoteLayoutView`.
 *
 * Mọi chữ đi qua `BoundText`: thay biến bằng `bindQuoteText` (chữ thuần) hoặc dựng chip ở chế độ thiết kế; React tự thoát
 * ký tự. Không có `dangerouslySetInnerHTML`.
 */
import {
  bindQuoteText,
  splitQuoteText,
  type QuoteLayoutAlign,
  type QuoteLayoutBlock,
  type QuoteLayoutBlockType,
  type QuoteLayoutCompanyHeaderBlock,
  type QuoteLayoutFieldGridBlock,
  type QuoteLayoutImageBlock,
  type QuoteLayoutLineTableBlock,
  type QuoteLayoutSignatureBlock,
  type QuoteLayoutSignatureParty,
  type QuoteLayoutTermsBlock,
  type QuoteLayoutTextBlock,
  type QuoteLayoutTitleBlock,
  type QuoteLayoutTotalsBlock,
} from '@enterprise-platform/contracts-crm';
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { companyHeaderLogo, type QuoteLayoutData, type QuoteLayoutLineRow } from './quote-layout.data';
import styles from './quote-layout.module.scss';

export type QuoteLayoutViewMode = 'design' | 'preview' | 'print';

/** Tên tiếng Việt của từng loại khối (nhãn truy cập ở chế độ thiết kế; trình thiết kế dùng lại). */
export const QUOTE_LAYOUT_BLOCK_LABELS: Readonly<Record<QuoteLayoutBlockType, string>> = {
  image: 'Ảnh',
  companyHeader: 'Đầu trang công ty',
  title: 'Tiêu đề',
  text: 'Đoạn văn',
  fieldGrid: 'Bảng thông tin',
  lineTable: 'Bảng dòng hàng',
  totals: 'Tổng tiền',
  terms: 'Điều khoản',
  signature: 'Chữ ký',
  spacer: 'Khoảng trắng',
  divider: 'Đường kẻ',
};

/** Câu hiện trong bảng dòng hàng rỗng ở chế độ xem trước và thiết kế. */
export const QUOTE_LAYOUT_EMPTY_LINES_TEXT = 'Chưa có dòng hàng';

/** Chỉ nhận ảnh đã nhúng (data URL PNG/JPEG); không bao giờ tải ảnh từ đường dẫn ngoài. */
export function isEmbeddedImage(src: string | null | undefined): src is string {
  return typeof src === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(src);
}

interface BlockContext {
  readonly mode: QuoteLayoutViewMode;
  readonly data: QuoteLayoutData;
}

const ALIGN_CLASS: Readonly<Record<QuoteLayoutAlign, string>> = {
  left: styles.alignLeft,
  center: styles.alignCenter,
  right: styles.alignRight,
};

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

/**
 * Chữ có biến. Xem trước và in: chữ thuần đã thay biến (biến rỗng thành chuỗi rỗng, biến lạ giữ nguyên văn, D3-13).
 * Thiết kế: biến hợp lệ thành chip, hiện giá trị nếu có, không có thì hiện `{{tên}}`.
 */
export function BoundText({ text, mode, values }: { text: string; mode: QuoteLayoutViewMode; values: QuoteLayoutData['values'] }) {
  if (mode !== 'design') return <>{bindQuoteText(text, values, 'view').normalize('NFC')}</>;
  return (
    <>
      {splitQuoteText(text).map((segment, index) => {
        if (segment.kind === 'text') return <Fragment key={index}>{segment.text.normalize('NFC')}</Fragment>;
        const value = Object.prototype.hasOwnProperty.call(values, segment.name) ? values[segment.name] : '';
        return (
          <span key={index} className={styles.chip} title={segment.raw} data-variable={segment.name}>
            {value ? value : segment.raw}
          </span>
        );
      })}
    </>
  );
}

function ImageBlockView({ block, mode }: { block: QuoteLayoutImageBlock; mode: QuoteLayoutViewMode }) {
  return (
    <div className={cx(styles.imageBlock, ALIGN_CLASS[block.align])}>
      {isEmbeddedImage(block.src) ? (
        <img src={block.src} alt="" style={{ height: `${block.heightMm}mm` }} className={styles.image} />
      ) : mode === 'design' ? (
        <span className={styles.placeholder} style={{ height: `${block.heightMm}mm` }}>
          Chưa có ảnh
        </span>
      ) : null}
    </div>
  );
}

function CompanyHeaderView({ block, ctx }: { block: QuoteLayoutCompanyHeaderBlock; ctx: BlockContext }) {
  const src = companyHeaderLogo(block, ctx.data);
  const logo = isEmbeddedImage(src) ? <img src={src} alt="" className={styles.companyLogo} /> : null;
  return (
    <div className={cx(styles.companyHeader, block.logoPosition === 'right' && styles.companyHeaderReverse)}>
      {logo}
      <div className={cx(styles.companyText, ALIGN_CLASS[block.align])}>
        <div className={styles.companyName}>
          <BoundText text={block.name} mode={ctx.mode} values={ctx.data.values} />
        </div>
        {block.lines.map((line, index) => (
          <div key={index} className={styles.companyLine}>
            <BoundText text={line} mode={ctx.mode} values={ctx.data.values} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TitleView({ block, ctx }: { block: QuoteLayoutTitleBlock; ctx: BlockContext }) {
  return (
    <div className={cx(styles.title, ALIGN_CLASS[block.align])}>
      <div className={cx(styles.titleText, block.uppercase && styles.uppercase)} style={{ fontSize: `${block.fontSizePt}pt` }}>
        <BoundText text={block.text} mode={ctx.mode} values={ctx.data.values} />
      </div>
      {block.subtitle ? (
        <div className={styles.subtitle}>
          <BoundText text={block.subtitle} mode={ctx.mode} values={ctx.data.values} />
        </div>
      ) : null}
    </div>
  );
}

function TextView({ block, ctx }: { block: QuoteLayoutTextBlock; ctx: BlockContext }) {
  return (
    <p className={cx(styles.text, ALIGN_CLASS[block.align])}>
      {block.runs.map((run, index) => {
        const style: CSSProperties = {
          fontWeight: run.bold ? 700 : undefined,
          fontStyle: run.italic ? 'italic' : undefined,
          textDecoration: run.underline ? 'underline' : undefined,
        };
        return (
          <span key={index} style={style}>
            <BoundText text={run.text} mode={ctx.mode} values={ctx.data.values} />
          </span>
        );
      })}
    </p>
  );
}

function FieldGridView({ block, ctx }: { block: QuoteLayoutFieldGridBlock; ctx: BlockContext }) {
  const labelWidth = `${block.labelWidthPct}%`;
  return (
    <div className={cx(styles.fieldGrid, block.columns === 2 && styles.fieldGridTwo)}>
      {block.items.map((item, index) => (
        <div key={index} className={styles.fieldItem}>
          <span className={styles.fieldLabel} style={{ flexBasis: labelWidth, maxWidth: labelWidth }}>
            <BoundText text={item.label} mode={ctx.mode} values={ctx.data.values} />
            {item.label ? ':' : ''}
          </span>
          <span className={styles.fieldValue}>
            <BoundText text={item.value} mode={ctx.mode} values={ctx.data.values} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Cột hiện kèm độ rộng đã chuẩn hoá về tổng 100%. */
export function visibleLineColumns(block: QuoteLayoutLineTableBlock) {
  const visible = block.columns.filter((column) => column.visible);
  const total = visible.reduce((sum, column) => sum + column.widthPct, 0);
  return visible.map((column) => ({
    ...column,
    widthPct: total > 0 ? (column.widthPct / total) * 100 : 100 / visible.length,
  }));
}

/** Dòng hàng kèm dòng nhóm (khi `showGroupByCategory`): chèn tiêu đề nhóm mỗi khi nhóm đổi, không đảo thứ tự dòng. */
export function lineTableRows(
  block: QuoteLayoutLineTableBlock,
  lines: readonly QuoteLayoutLineRow[],
): Array<{ kind: 'group'; label: string } | { kind: 'line'; line: QuoteLayoutLineRow; stripe: boolean }> {
  const rows: Array<{ kind: 'group'; label: string } | { kind: 'line'; line: QuoteLayoutLineRow; stripe: boolean }> = [];
  let current: string | null = null;
  let stripe = false;
  for (const line of lines) {
    if (block.showGroupByCategory && line.category !== current) {
      current = line.category;
      rows.push({ kind: 'group', label: line.category || 'Chưa phân nhóm' });
      stripe = false;
    }
    rows.push({ kind: 'line', line, stripe });
    stripe = !stripe;
  }
  return rows;
}

function LineTableView({ block, ctx }: { block: QuoteLayoutLineTableBlock; ctx: BlockContext }) {
  const columns = visibleLineColumns(block);
  const rows = lineTableRows(block, ctx.data.lines);
  return (
    <table className={styles.lineTable}>
      <colgroup>
        {columns.map((column) => (
          <col key={column.key} style={{ width: `${column.widthPct}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} className={ALIGN_CLASS[column.align]}>
              <BoundText text={column.label} mode={ctx.mode} values={ctx.data.values} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && ctx.mode !== 'print' ? (
          <tr className={styles.emptyRow}>
            <td colSpan={columns.length}>{QUOTE_LAYOUT_EMPTY_LINES_TEXT}</td>
          </tr>
        ) : null}
        {rows.map((row, index) =>
          row.kind === 'group' ? (
            <tr key={`g-${index}`} className={styles.groupRow}>
              <td colSpan={columns.length}>{row.label}</td>
            </tr>
          ) : (
            <tr key={row.line.id} className={cx(block.zebra && row.stripe && styles.zebraRow)}>
              {columns.map((column) => (
                <td key={column.key} className={ALIGN_CLASS[column.align]}>
                  {row.line.cells[column.key]}
                </td>
              ))}
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

function TotalsView({ block, ctx }: { block: QuoteLayoutTotalsBlock; ctx: BlockContext }) {
  const rows = block.rows.filter((row) => row.visible);
  return (
    <div className={cx(styles.totals, ALIGN_CLASS[block.align])}>
      {rows.length ? (
        <table className={styles.totalsTable}>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={cx(row.key === 'grandTotal' && styles.grandTotal)}>
                <th scope="row">
                  <BoundText text={row.label} mode={ctx.mode} values={ctx.data.values} />
                </th>
                <td>{ctx.data.totals[row.key]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {block.showAmountInWords ? (
        <p className={styles.amountInWords}>
          Số tiền bằng chữ: <BoundText text="{{totals.amountInWords}}" mode={ctx.mode} values={ctx.data.values} />
        </p>
      ) : null}
    </div>
  );
}

function TermsView({ block, ctx }: { block: QuoteLayoutTermsBlock; ctx: BlockContext }) {
  const items = block.items.map((item, index) => {
    // Giá trị nhiều dòng (ghi chú, trường tuỳ biến văn bản) bắt đầu ở dòng dưới nhãn để các dòng thẳng hàng.
    const breakAfterLabel = Boolean(item.label) && ctx.mode !== 'design' && bindQuoteText(item.value, ctx.data.values, 'view').includes('\n');
    return (
      <li key={index} className={styles.termItem}>
        {item.label ? (
          <span className={styles.termLabel}>
            <BoundText text={item.label} mode={ctx.mode} values={ctx.data.values} />:{breakAfterLabel ? '\n' : ' '}
          </span>
        ) : null}
        <BoundText text={item.value} mode={ctx.mode} values={ctx.data.values} />
      </li>
    );
  });
  return block.numbered ? <ol className={styles.terms}>{items}</ol> : <ul className={cx(styles.terms, styles.termsPlain)}>{items}</ul>;
}

function SignaturePartyView({ party, heightMm, ctx }: { party: QuoteLayoutSignatureParty; heightMm: number; ctx: BlockContext }) {
  return (
    <div className={styles.signatureParty}>
      <div className={styles.signatureTitle}>
        <BoundText text={party.title} mode={ctx.mode} values={ctx.data.values} />
      </div>
      {party.subtitle ? (
        <div className={styles.signatureSubtitle}>
          <BoundText text={party.subtitle} mode={ctx.mode} values={ctx.data.values} />
        </div>
      ) : null}
      <div style={{ height: `${heightMm}mm` }} />
      {party.name ? (
        <div className={styles.signatureName}>
          <BoundText text={party.name} mode={ctx.mode} values={ctx.data.values} />
        </div>
      ) : null}
    </div>
  );
}

function SignatureView({ block, ctx }: { block: QuoteLayoutSignatureBlock; ctx: BlockContext }) {
  return (
    <div className={styles.signature}>
      <SignaturePartyView party={block.left} heightMm={block.heightMm} ctx={ctx} />
      <SignaturePartyView party={block.right} heightMm={block.heightMm} ctx={ctx} />
    </div>
  );
}

/** Nội dung của một khối (không gồm khung chọn của chế độ thiết kế). */
export function QuoteLayoutBlockContent({ block, mode, data }: { block: QuoteLayoutBlock; mode: QuoteLayoutViewMode; data: QuoteLayoutData }): ReactNode {
  const ctx: BlockContext = { mode, data };
  switch (block.type) {
    case 'image':
      return <ImageBlockView block={block} mode={mode} />;
    case 'companyHeader':
      return <CompanyHeaderView block={block} ctx={ctx} />;
    case 'title':
      return <TitleView block={block} ctx={ctx} />;
    case 'text':
      return <TextView block={block} ctx={ctx} />;
    case 'fieldGrid':
      return <FieldGridView block={block} ctx={ctx} />;
    case 'lineTable':
      return <LineTableView block={block} ctx={ctx} />;
    case 'totals':
      return <TotalsView block={block} ctx={ctx} />;
    case 'terms':
      return <TermsView block={block} ctx={ctx} />;
    case 'signature':
      return <SignatureView block={block} ctx={ctx} />;
    case 'spacer':
      return <div className={cx(styles.spacer, mode === 'design' && styles.spacerDesign)} style={{ height: `${block.heightMm}mm` }} />;
    case 'divider':
      return <div className={styles.divider} style={{ borderTop: `${block.thicknessPt}pt ${block.style} currentColor` }} />;
    default:
      return null;
  }
}
