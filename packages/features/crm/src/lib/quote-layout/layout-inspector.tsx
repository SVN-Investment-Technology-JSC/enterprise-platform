'use client';

/**
 * Vùng thuộc tính bên phải của trình thiết kế (plan mục 9.3, task P3C3-04, P3C3-05): thuộc tính khối đang chọn; chưa chọn
 * khối thì hiện thiết lập trang. Mọi thay đổi đi qua `onBlockChange` / `onPageChange`; lần sửa do gõ phím kèm khoá ô để
 * lịch sử hoàn tác gộp thành một bước.
 */
import {
  QUOTE_LAYOUT_FONTS,
  QUOTE_LAYOUT_LIMITS,
  type CustomFieldDefinition,
  type QuoteLayout,
  type QuoteLayoutBlock,
  type QuoteLayoutCompanyHeaderBlock,
  type QuoteLayoutDividerBlock,
  type QuoteLayoutError,
  type QuoteLayoutFieldGridBlock,
  type QuoteLayoutImageBlock,
  type QuoteLayoutLabelValue,
  type QuoteLayoutLineTableBlock,
  type QuoteLayoutSignatureBlock,
  type QuoteLayoutSignatureParty,
  type QuoteLayoutSpacerBlock,
  type QuoteLayoutTermsBlock,
  type QuoteLayoutTextBlock,
  type QuoteLayoutTextRun,
  type QuoteLayoutTitleBlock,
  type QuoteLayoutTotalsBlock,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { ArrowDown, ArrowUp, Bold, GripVertical, ImagePlus, Italic, Plus, Trash2, Underline } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { equalizeColumnWidths, lineTableError, moveItem, visibleWidthTotal, type BlockPatch, type PagePatch } from './layout-designer.model';
import { AlignField, CheckField, FieldRow, NumberField, SegmentedField, TextField } from './layout-fields';
import { readLayoutImage } from './layout-image';
import styles from './layout-designer.module.scss';
import { QUOTE_LAYOUT_BLOCK_LABELS } from './quote-layout-blocks';

const LIMITS = QUOTE_LAYOUT_LIMITS;

export const PAPER_OPTIONS = [
  { value: 'A4', label: 'A4' },
  { value: 'A3', label: 'A3' },
];
export const ORIENTATION_OPTIONS = [
  { value: 'portrait', label: 'Đứng' },
  { value: 'landscape', label: 'Ngang' },
];
export const FONT_OPTIONS = QUOTE_LAYOUT_FONTS.map((font) => ({ value: font, label: font }));
export const FONT_SIZE_OPTIONS = Array.from({ length: LIMITS.fontSizePt.max - LIMITS.fontSizePt.min + 1 }, (_, index) => {
  const size = String(LIMITS.fontSizePt.min + index);
  return { value: size, label: `${size} pt` };
});

/** Ghi chú khi bật cả dòng "Thuế GTGT" và "Thuế tổng đơn" (D3-16). */
export const ORDER_TAX_TWICE_HINT =
  'Đang hiện cả "Thuế GTGT" và "Thuế tổng đơn". Thuế GTGT đã gồm thuế tổng đơn, nên phần thuế tổng đơn sẽ hiện hai lần trên bản in.';

export interface LayoutInspectorProps {
  readonly layout: QuoteLayout;
  /** Khối đang chọn; `null` thì hiện thiết lập trang. */
  readonly block: QuoteLayoutBlock | null;
  readonly blockNumber: number;
  /** Lỗi kiểm hợp lệ của khối đang chọn (hoặc của trang khi chưa chọn khối). */
  readonly errors: readonly QuoteLayoutError[];
  /** Trường tuỳ biến đang bật, cho danh sách biến. */
  readonly customFields: readonly CustomFieldDefinition[];
  readonly onBlockChange: (patch: BlockPatch, typingKey?: string) => void;
  readonly onPageChange: (patch: PagePatch, typingKey?: string) => void;
  readonly onEndTyping: () => void;
}

interface EditorContext<B extends QuoteLayoutBlock> {
  readonly block: B;
  readonly customFields: readonly CustomFieldDefinition[];
  /** Sửa thuộc tính; `field` có giá trị là lần gõ phím trong ô đó (gộp bước hoàn tác). */
  readonly set: (patch: BlockPatch<B>, field?: string) => void;
  readonly endTyping: () => void;
}

/** Ô chữ của khối: gõ phím gộp theo `field`, chèn biến là bước riêng. */
function blockText<B extends QuoteLayoutBlock>(
  ctx: EditorContext<B>,
  field: string,
  label: string,
  value: string,
  make: (value: string) => BlockPatch<B>,
  options: { multiline?: boolean; variables?: boolean; label?: boolean; hideLabel?: boolean; placeholder?: string } = {},
) {
  return (
    <TextField
      key={field}
      label={label}
      value={value}
      maxLength={options.label ? LIMITS.maxLabelLength : LIMITS.maxTextLength}
      multiline={options.multiline}
      variables={options.variables ?? true}
      hideLabel={options.hideLabel}
      placeholder={options.placeholder}
      customFields={ctx.customFields}
      onEndTyping={ctx.endTyping}
      onChange={(next, typing) => ctx.set(make(next), typing ? field : undefined)}
    />
  );
}

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className={styles.inspectorSection} aria-label={title}>
      <header className={styles.inspectorSectionHead}>
        <h3>{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  );
}

function IconButton({ label, onClick, disabled, children, danger }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; danger?: boolean }) {
  return (
    <button type="button" className={danger ? styles.iconButtonDanger : styles.iconButton} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** Nút lên, xuống, xoá cho một mục trong danh sách. */
function ItemActions({ index, count, name, onMove, onRemove, minCount = 0 }: { index: number; count: number; name: string; onMove: (to: number) => void; onRemove?: () => void; minCount?: number }) {
  return (
    <span className={styles.itemActions}>
      <IconButton label={`Đưa ${name} lên`} disabled={index === 0} onClick={() => onMove(index - 1)}>
        <ArrowUp size={14} aria-hidden="true" />
      </IconButton>
      <IconButton label={`Đưa ${name} xuống`} disabled={index === count - 1} onClick={() => onMove(index + 1)}>
        <ArrowDown size={14} aria-hidden="true" />
      </IconButton>
      {onRemove ? (
        <IconButton label={`Xoá ${name}`} danger disabled={count <= minCount} onClick={onRemove}>
          <Trash2 size={14} aria-hidden="true" />
        </IconButton>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Ảnh
// ---------------------------------------------------------------------------

/** Chọn ảnh PNG/JPEG, tự thu nhỏ; lỗi hiện ngay dưới nút. */
function ImagePicker({ label, value, onChange, onRemove }: { label: string; value: string | undefined; onChange: (dataUrl: string) => void; onRemove?: () => void }) {
  const input = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const result = await readLayoutImage(file);
    setBusy(false);
    if (result.ok) onChange(result.dataUrl);
    else setError(result.message);
  };
  return (
    <FieldRow label={label} error={error} hint="PNG hoặc JPEG; ảnh lớn được tự thu về rộng tối đa 1.600 px và nén JPEG dưới 300 KB.">
      <div className={styles.imagePicker}>
        {value ? <img src={value} alt="" className={styles.imageThumb} /> : <span className={styles.imageEmpty}>Chưa có ảnh</span>}
        <div className={styles.imageActions}>
          <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => input.current?.click()}>
            <ImagePlus size={14} aria-hidden="true" />
            {busy ? 'Đang xử lý…' : value ? 'Đổi ảnh' : 'Chọn ảnh'}
          </button>
          {value && onRemove ? (
            <button type="button" className={styles.buttonGhost} onClick={onRemove}>
              Bỏ ảnh
            </button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          aria-label={label}
          data-testid="layout-image-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void pick(file);
          }}
        />
      </div>
    </FieldRow>
  );
}

// ---------------------------------------------------------------------------
// Từng loại khối
// ---------------------------------------------------------------------------

function ImageEditor(ctx: EditorContext<QuoteLayoutImageBlock>) {
  const { block, set } = ctx;
  return (
    <>
      <ImagePicker label="Ảnh" value={block.src || undefined} onChange={(src) => set({ src })} />
      <NumberField label="Chiều cao" unit="mm" value={block.heightMm} {...LIMITS.imageHeightMm} onChange={(heightMm) => heightMm !== undefined && set({ heightMm })} />
      <AlignField value={block.align} onChange={(align) => set({ align })} />
    </>
  );
}

function CompanyHeaderEditor(ctx: EditorContext<QuoteLayoutCompanyHeaderBlock>) {
  const { block, set } = ctx;
  const setLine = (index: number, value: string) => block.lines.map((line, position) => (position === index ? value : line));
  return (
    <>
      {blockText(ctx, 'name', 'Tên công ty', block.name, (name) => ({ name }))}
      <Section
        title="Dòng thông tin"
        actions={
          <button
            type="button"
            className={styles.linkButton}
            disabled={block.lines.length >= LIMITS.maxCompanyLines}
            onClick={() => set({ lines: [...block.lines, ''] })}
          >
            <Plus size={13} aria-hidden="true" /> Thêm dòng
          </button>
        }
      >
        {block.lines.map((line, index) => (
          <div key={index} className={styles.listRow}>
            {blockText(ctx, `lines.${index}`, `Dòng ${index + 1}`, line, (value) => ({ lines: setLine(index, value) }), { hideLabel: true })}
            <ItemActions
              index={index}
              count={block.lines.length}
              name={`dòng ${index + 1}`}
              onMove={(to) => set({ lines: moveItem(block.lines, index, to) })}
              onRemove={() => set({ lines: block.lines.filter((_, position) => position !== index) })}
            />
          </div>
        ))}
        <p className={styles.fieldHint}>Tối đa {LIMITS.maxCompanyLines} dòng: địa chỉ, mã số thuế, điện thoại...</p>
      </Section>
      <CheckField
        label="Logo theo tổ chức báo giá"
        checked={block.logoFromOrganization === true}
        onChange={(logoFromOrganization) => set({ logoFromOrganization })}
      />
      <p className={styles.fieldHint}>
        Bật thì in logo của tổ chức báo giá; tổ chức không có logo thì dùng ảnh bên dưới.
      </p>
      <ImagePicker
        label={block.logoFromOrganization ? 'Logo dự phòng' : 'Logo'}
        value={block.logo}
        onChange={(logo) => set({ logo })}
        onRemove={() => set({ logo: undefined })}
      />
      <SegmentedField
        label="Vị trí logo"
        value={block.logoPosition}
        options={[
          { value: 'left', label: 'Bên trái' },
          { value: 'right', label: 'Bên phải' },
        ]}
        onChange={(logoPosition) => set({ logoPosition })}
      />
      <AlignField value={block.align} onChange={(align) => set({ align })} />
    </>
  );
}

function TitleEditor(ctx: EditorContext<QuoteLayoutTitleBlock>) {
  const { block, set } = ctx;
  return (
    <>
      {blockText(ctx, 'text', 'Tiêu đề', block.text, (text) => ({ text }))}
      {blockText(ctx, 'subtitle', 'Dòng phụ', block.subtitle ?? '', (subtitle) => ({ subtitle: subtitle || undefined }))}
      <NumberField label="Cỡ chữ" unit="pt" value={block.fontSizePt} {...LIMITS.titleFontSizePt} onChange={(fontSizePt) => fontSizePt !== undefined && set({ fontSizePt })} />
      <AlignField value={block.align} onChange={(align) => set({ align })} />
      <CheckField label="Viết hoa toàn bộ" checked={block.uppercase} onChange={(uppercase) => set({ uppercase })} />
    </>
  );
}

function TextEditor(ctx: EditorContext<QuoteLayoutTextBlock>) {
  const { block, set } = ctx;
  const setRun = (index: number, patch: Partial<QuoteLayoutTextRun>) => block.runs.map((run, position) => (position === index ? { ...run, ...patch } : run));
  const style = (index: number, key: 'bold' | 'italic' | 'underline', label: string, icon: ReactNode) => {
    const active = Boolean(block.runs[index][key]);
    return (
      <button
        type="button"
        className={active ? styles.toggleActive : styles.toggle}
        aria-pressed={active}
        aria-label={`${label} đoạn ${index + 1}`}
        title={label}
        onClick={() =>
          set({
            runs: block.runs.map((run, position) => {
              if (position !== index) return run;
              const next: { -readonly [K in keyof QuoteLayoutTextRun]: QuoteLayoutTextRun[K] } = { ...run };
              if (active) delete next[key];
              else next[key] = true;
              return next;
            }),
          })
        }
      >
        {icon}
      </button>
    );
  };
  return (
    <>
      <Section
        title="Nội dung"
        actions={
          <button type="button" className={styles.linkButton} onClick={() => set({ runs: [...block.runs, { text: '' }] })}>
            <Plus size={13} aria-hidden="true" /> Thêm đoạn chữ
          </button>
        }
      >
        {block.runs.map((run, index) => (
          <div key={index} className={styles.runItem}>
            <div className={styles.runToolbar}>
              <span className={styles.muted}>Đoạn {index + 1}</span>
              {style(index, 'bold', 'Đậm', <Bold size={14} aria-hidden="true" />)}
              {style(index, 'italic', 'Nghiêng', <Italic size={14} aria-hidden="true" />)}
              {style(index, 'underline', 'Gạch chân', <Underline size={14} aria-hidden="true" />)}
              <ItemActions
                index={index}
                count={block.runs.length}
                name={`đoạn ${index + 1}`}
                minCount={1}
                onMove={(to) => set({ runs: moveItem(block.runs, index, to) })}
                onRemove={() => set({ runs: block.runs.filter((_, position) => position !== index) })}
              />
            </div>
            {blockText(ctx, `runs.${index}`, `Chữ đoạn ${index + 1}`, run.text, (text) => ({ runs: setRun(index, { text }) }), { multiline: true, hideLabel: true })}
          </div>
        ))}
      </Section>
      <AlignField value={block.align} onChange={(align) => set({ align })} />
    </>
  );
}

/** Danh sách nhãn và giá trị (`fieldGrid`, `terms`). */
function LabelValueList<B extends QuoteLayoutFieldGridBlock | QuoteLayoutTermsBlock>({
  ctx,
  title,
  addLabel,
}: {
  ctx: EditorContext<B>;
  title: string;
  addLabel: string;
}) {
  const items = ctx.block.items;
  const setItems = (next: readonly QuoteLayoutLabelValue[]) => ({ items: next }) as BlockPatch<B>;
  const setItem = (index: number, patch: Partial<QuoteLayoutLabelValue>) => setItems(items.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  return (
    <Section
      title={title}
      actions={
        <button type="button" className={styles.linkButton} onClick={() => ctx.set(setItems([...items, { label: '', value: '' }]))}>
          <Plus size={13} aria-hidden="true" /> {addLabel}
        </button>
      }
    >
      {items.length === 0 ? <p className={styles.muted}>Chưa có mục nào.</p> : null}
      {items.map((item, index) => (
        <div key={index} className={styles.pairItem}>
          <div className={styles.pairHead}>
            <span className={styles.muted}>Mục {index + 1}</span>
            <ItemActions
              index={index}
              count={items.length}
              name={`mục ${index + 1}`}
              onMove={(to) => ctx.set(setItems(moveItem(items, index, to)))}
              onRemove={() => ctx.set(setItems(items.filter((_, position) => position !== index)))}
            />
          </div>
          {blockText(ctx, `items.${index}.label`, `Nhãn mục ${index + 1}`, item.label, (label) => setItem(index, { label }), {
            label: true,
            variables: false,
            hideLabel: true,
            placeholder: 'Nhãn',
          })}
          {blockText(ctx, `items.${index}.value`, `Giá trị mục ${index + 1}`, item.value, (value) => setItem(index, { value }), { hideLabel: true, placeholder: 'Giá trị (có thể chèn biến)' })}
        </div>
      ))}
    </Section>
  );
}

function FieldGridEditor(ctx: EditorContext<QuoteLayoutFieldGridBlock>) {
  const { block, set } = ctx;
  return (
    <>
      <SegmentedField
        label="Số cột"
        value={block.columns}
        options={[
          { value: 1, label: '1 cột' },
          { value: 2, label: '2 cột' },
        ]}
        onChange={(columns) => set({ columns })}
      />
      <NumberField label="Độ rộng nhãn" unit="%" value={block.labelWidthPct} {...LIMITS.labelWidthPct} onChange={(labelWidthPct) => labelWidthPct !== undefined && set({ labelWidthPct })} />
      <LabelValueList ctx={ctx} title="Các ô thông tin" addLabel="Thêm ô" />
    </>
  );
}

function TermsEditor(ctx: EditorContext<QuoteLayoutTermsBlock>) {
  return (
    <>
      <CheckField label="Đánh số thứ tự" checked={ctx.block.numbered} onChange={(numbered) => ctx.set({ numbered })} />
      <LabelValueList ctx={ctx} title="Điều khoản" addLabel="Thêm điều khoản" />
      <p className={styles.fieldHint}>Điều khoản thanh toán, tiến độ giao hàng thường lấy từ trường tuỳ biến của báo giá (nhóm "Trường tuỳ biến").</p>
    </>
  );
}

function LineTableEditor(ctx: EditorContext<QuoteLayoutLineTableBlock>) {
  const { block, set } = ctx;
  const [dragging, setDragging] = useState<number | null>(null);
  const columns = block.columns;
  const setColumn = (index: number, patch: Partial<QuoteLayoutLineTableBlock['columns'][number]>) =>
    columns.map((column, position) => (position === index ? { ...column, ...patch } : column));
  const error = lineTableError(columns);
  const total = visibleWidthTotal(columns);
  return (
    <>
      <Section
        title="Cột của bảng"
        actions={
          <button type="button" className={styles.linkButton} onClick={() => set({ columns: equalizeColumnWidths(columns) })}>
            Chia đều độ rộng
          </button>
        }
      >
        <div className={styles.columnList} role="list" aria-label="Cột của bảng">
          {columns.map((column, index) => (
            <div
              key={column.key}
              role="listitem"
              className={dragging === index ? `${styles.columnRow} ${styles.columnRowDragging}` : styles.columnRow}
              draggable
              onDragStart={(event) => {
                setDragging(index);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', column.key);
              }}
              onDragOver={(event) => {
                if (dragging === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== null && dragging !== index) set({ columns: moveItem(columns, dragging, index) });
                setDragging(null);
              }}
              onDragEnd={() => setDragging(null)}
            >
              <span className={styles.dragHandle} aria-hidden="true">
                <GripVertical size={14} />
              </span>
              <input
                type="checkbox"
                checked={column.visible}
                aria-label={`Hiện cột ${column.label}`}
                onChange={(event) => set({ columns: setColumn(index, { visible: event.target.checked }) })}
              />
              <div className={styles.columnLabel}>
                {blockText(ctx, `columns.${column.key}.label`, `Nhãn cột ${index + 1}`, column.label, (label) => ({ columns: setColumn(index, { label }) }), {
                  label: true,
                  variables: false,
                  hideLabel: true,
                })}
              </div>
              <div className={styles.columnWidth}>
                <NumberField
                  compact
                  label={`Độ rộng cột ${column.label} (%)`}
                  value={column.widthPct}
                  {...LIMITS.columnWidthPct}
                  onChange={(widthPct) => widthPct !== undefined && set({ columns: setColumn(index, { widthPct }) })}
                />
              </div>
              <AlignField bare label={`Căn lề cột ${column.label}`} value={column.align} onChange={(align) => set({ columns: setColumn(index, { align }) })} />
              <ItemActions index={index} count={columns.length} name={`cột ${column.label}`} onMove={(to) => set({ columns: moveItem(columns, index, to) })} />
            </div>
          ))}
        </div>
        <p className={error ? styles.fieldError : styles.fieldHint} role={error ? 'alert' : undefined}>
          {error ?? `Tổng độ rộng các cột đang hiện: ${String(total).replace('.', ',')}%.`}
        </p>
      </Section>
      <CheckField label="Nhóm dòng theo nhóm hàng" checked={Boolean(block.showGroupByCategory)} onChange={(showGroupByCategory) => set({ showGroupByCategory })} />
      <CheckField label="Tô màu xen kẽ các dòng" checked={Boolean(block.zebra)} onChange={(zebra) => set({ zebra })} />
    </>
  );
}

function TotalsEditor(ctx: EditorContext<QuoteLayoutTotalsBlock>) {
  const { block, set } = ctx;
  const rows = block.rows;
  const setRow = (index: number, patch: Partial<QuoteLayoutTotalsBlock['rows'][number]>) => rows.map((row, position) => (position === index ? { ...row, ...patch } : row));
  const visible = (key: string) => rows.some((row) => row.key === key && row.visible);
  return (
    <>
      <Section title="Dòng tổng">
        {rows.map((row, index) => (
          <div key={row.key} className={styles.listRow}>
            <input
              type="checkbox"
              checked={row.visible}
              aria-label={`Hiện dòng ${row.label}`}
              onChange={(event) => set({ rows: setRow(index, { visible: event.target.checked }) })}
            />
            {blockText(ctx, `rows.${row.key}.label`, `Nhãn dòng ${index + 1}`, row.label, (label) => ({ rows: setRow(index, { label }) }), {
              label: true,
              variables: false,
              hideLabel: true,
            })}
            <ItemActions index={index} count={rows.length} name={`dòng ${row.label}`} onMove={(to) => set({ rows: moveItem(rows, index, to) })} />
          </div>
        ))}
        {visible('vat') && visible('orderTax') ? (
          <p className={styles.fieldWarning} role="note">
            {ORDER_TAX_TWICE_HINT}
          </p>
        ) : null}
        <p className={styles.fieldHint}>Dòng có giá trị 0 vẫn in nếu đang bật. Chiết khấu tổng đơn và thuế tổng đơn chỉ có số khi mẫu tính theo tổng đơn.</p>
      </Section>
      <CheckField label="In số tiền bằng chữ" checked={block.showAmountInWords} onChange={(showAmountInWords) => set({ showAmountInWords })} />
      <AlignField value={block.align} onChange={(align) => set({ align })} />
    </>
  );
}

function SignatureEditor(ctx: EditorContext<QuoteLayoutSignatureBlock>) {
  const { block, set } = ctx;
  const party = (side: 'left' | 'right', title: string) => {
    const value = block[side];
    const patch = (change: Partial<QuoteLayoutSignatureParty>): BlockPatch<QuoteLayoutSignatureBlock> => {
      const next: QuoteLayoutSignatureParty = { ...value, ...change };
      const cleaned: QuoteLayoutSignatureParty = { title: next.title, ...(next.subtitle ? { subtitle: next.subtitle } : {}), ...(next.name ? { name: next.name } : {}) };
      return side === 'left' ? { left: cleaned } : { right: cleaned };
    };
    return (
      <Section title={title}>
        {blockText(ctx, `${side}.title`, 'Tiêu đề', value.title, (text) => patch({ title: text }), { label: true })}
        {blockText(ctx, `${side}.subtitle`, 'Dòng phụ', value.subtitle ?? '', (text) => patch({ subtitle: text }))}
        {blockText(ctx, `${side}.name`, 'Họ tên', value.name ?? '', (text) => patch({ name: text }))}
      </Section>
    );
  };
  return (
    <>
      {party('left', 'Bên trái')}
      {party('right', 'Bên phải')}
      <NumberField label="Chiều cao vùng ký" unit="mm" value={block.heightMm} {...LIMITS.signatureHeightMm} onChange={(heightMm) => heightMm !== undefined && set({ heightMm })} />
    </>
  );
}

function SpacerEditor({ block, set }: EditorContext<QuoteLayoutSpacerBlock>) {
  return <NumberField label="Chiều cao" unit="mm" value={block.heightMm} {...LIMITS.spacerHeightMm} onChange={(heightMm) => heightMm !== undefined && set({ heightMm })} />;
}

function DividerEditor({ block, set }: EditorContext<QuoteLayoutDividerBlock>) {
  return (
    <>
      <NumberField
        label="Độ dày"
        unit="pt"
        step={0.5}
        value={block.thicknessPt}
        {...LIMITS.dividerThicknessPt}
        onChange={(thicknessPt) => thicknessPt !== undefined && set({ thicknessPt })}
      />
      <SegmentedField
        label="Kiểu đường"
        value={block.style}
        options={[
          { value: 'solid', label: 'Liền' },
          { value: 'dashed', label: 'Nét đứt' },
        ]}
        onChange={(style) => set({ style })}
      />
    </>
  );
}

function BlockEditor({ block, ...rest }: Omit<EditorContext<QuoteLayoutBlock>, 'set'> & { set: (patch: BlockPatch, field?: string) => void }) {
  const ctx = { ...rest, block };
  switch (block.type) {
    case 'image':
      return <ImageEditor {...(ctx as EditorContext<QuoteLayoutImageBlock>)} />;
    case 'companyHeader':
      return <CompanyHeaderEditor {...(ctx as EditorContext<QuoteLayoutCompanyHeaderBlock>)} />;
    case 'title':
      return <TitleEditor {...(ctx as EditorContext<QuoteLayoutTitleBlock>)} />;
    case 'text':
      return <TextEditor {...(ctx as EditorContext<QuoteLayoutTextBlock>)} />;
    case 'fieldGrid':
      return <FieldGridEditor {...(ctx as EditorContext<QuoteLayoutFieldGridBlock>)} />;
    case 'lineTable':
      return <LineTableEditor {...(ctx as EditorContext<QuoteLayoutLineTableBlock>)} />;
    case 'totals':
      return <TotalsEditor {...(ctx as EditorContext<QuoteLayoutTotalsBlock>)} />;
    case 'terms':
      return <TermsEditor {...(ctx as EditorContext<QuoteLayoutTermsBlock>)} />;
    case 'signature':
      return <SignatureEditor {...(ctx as EditorContext<QuoteLayoutSignatureBlock>)} />;
    case 'spacer':
      return <SpacerEditor {...(ctx as EditorContext<QuoteLayoutSpacerBlock>)} />;
    case 'divider':
      return <DividerEditor {...(ctx as EditorContext<QuoteLayoutDividerBlock>)} />;
  }
}

/** Thiết lập trang: khổ, hướng, font, cỡ chữ, lề. */
export function PageSettings({ layout, onPageChange }: Pick<LayoutInspectorProps, 'layout' | 'onPageChange'>) {
  const margins = layout.marginsMm;
  const margin = (side: keyof typeof margins, label: string) => (
    <NumberField
      key={side}
      label={label}
      unit="mm"
      value={margins[side]}
      {...LIMITS.marginMm}
      onChange={(value) => value !== undefined && onPageChange({ marginsMm: { ...margins, [side]: value } })}
    />
  );
  return (
    <>
      <FieldRow label="Khổ giấy">
        <SearchableSelect
          options={PAPER_OPTIONS}
          value={layout.paper}
          clearable={false}
          searchInDropdown
          hideDropdownSearch
          height={34}
          onChange={(value) => value && onPageChange({ paper: value as QuoteLayout['paper'] })}
        />
      </FieldRow>
      <FieldRow label="Hướng giấy">
        <SearchableSelect
          options={ORIENTATION_OPTIONS}
          value={layout.orientation}
          clearable={false}
          searchInDropdown
          hideDropdownSearch
          height={34}
          onChange={(value) => value && onPageChange({ orientation: value as QuoteLayout['orientation'] })}
        />
      </FieldRow>
      <FieldRow label="Font chữ">
        <SearchableSelect
          options={FONT_OPTIONS}
          value={layout.fontFamily}
          clearable={false}
          searchInDropdown
          hideDropdownSearch
          height={34}
          onChange={(value) => value && onPageChange({ fontFamily: value as QuoteLayout['fontFamily'] })}
        />
      </FieldRow>
      <NumberField
        label="Cỡ chữ"
        unit="pt"
        value={layout.fontSizePt}
        {...LIMITS.fontSizePt}
        onChange={(fontSizePt) => fontSizePt !== undefined && onPageChange({ fontSizePt })}
      />
      <Section title="Lề trang">
        <div className={styles.marginGrid}>
          {margin('top', 'Trên')}
          {margin('right', 'Phải')}
          {margin('bottom', 'Dưới')}
          {margin('left', 'Trái')}
        </div>
      </Section>
    </>
  );
}

function ErrorList({ errors }: { errors: readonly QuoteLayoutError[] }) {
  if (!errors.length) return null;
  return (
    <ul className={styles.inspectorErrors} role="alert" aria-label="Lỗi của khối">
      {errors.map((error, index) => (
        <li key={`${error.path}-${index}`}>{error.message}</li>
      ))}
    </ul>
  );
}

export function LayoutInspector({ layout, block, blockNumber, errors, customFields, onBlockChange, onPageChange, onEndTyping }: LayoutInspectorProps) {
  if (!block) {
    return (
      <div className={styles.inspector} aria-label="Thuộc tính trang">
        <header className={styles.inspectorHead}>
          <h2>Thiết lập trang</h2>
          <p className={styles.muted}>Chọn một khối trên trang để sửa thuộc tính của khối.</p>
        </header>
        <ErrorList errors={errors} />
        <PageSettings layout={layout} onPageChange={onPageChange} />
      </div>
    );
  }
  const set = (patch: BlockPatch, field?: string) => onBlockChange(patch, field ? `${block.id}:${field}` : undefined);
  return (
    <div className={styles.inspector} aria-label={`Thuộc tính ${QUOTE_LAYOUT_BLOCK_LABELS[block.type]}`}>
      <header className={styles.inspectorHead}>
        <h2>
          {QUOTE_LAYOUT_BLOCK_LABELS[block.type]} <span className={styles.muted}>(khối {blockNumber})</span>
        </h2>
      </header>
      <ErrorList errors={errors} />
      <BlockEditor key={block.id} block={block} customFields={customFields} set={set} endTyping={onEndTyping} />
      <NumberField
        key={`${block.id}-margin`}
        label="Khoảng cách phía trên"
        unit="mm"
        optional
        value={block.marginTopMm}
        {...LIMITS.blockMarginTopMm}
        onChange={(marginTopMm) => set({ marginTopMm })}
      />
    </div>
  );
}
