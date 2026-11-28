'use client';

import { Checkbox, Popover, Radio } from 'antd';
import { Columns3 } from 'lucide-react';
import { voucherColumnSelection, type VoucherCellMode, type VoucherColumnDef } from '../voucher-list-columns';
import { Button } from './button';

/**
 * Chọn cột hiển thị của danh sách (cấu hình riêng từng người dùng) và cách hiện chữ trong ô. Bật/tắt cột áp dụng ngay; cột bắt buộc
 * không tắt được.
 */
export function ColumnPicker({
  catalog,
  visible,
  onChange,
  onReset,
  cellMode,
  onCellModeChange,
  onResetWidths,
}: {
  catalog: readonly VoucherColumnDef[];
  visible: ReadonlySet<string>;
  onChange: (keys: string[]) => void;
  onReset: () => void;
  cellMode: VoucherCellMode;
  onCellModeChange: (mode: VoucherCellMode) => void;
  /** Bỏ bề ngang cột đã kéo, về bề ngang mặc định. */
  onResetWidths: () => void;
}) {
  const toggle = (key: string, on: boolean) => {
    const next = new Set(visible);
    if (on) next.add(key);
    else next.delete(key);
    onChange(voucherColumnSelection(catalog, next));
  };
  const content = (
    <div className="w-60">
      <ul role="group" aria-label="Cột hiển thị" className="max-h-80 space-y-1 overflow-y-auto">
        {catalog.map((column) => (
          <li key={column.key}>
            <Checkbox
              checked={column.required || visible.has(column.key)}
              disabled={column.required}
              onChange={(event) => toggle(column.key, event.target.checked)}
            >
              {column.label}
            </Checkbox>
          </li>
        ))}
      </ul>
      <div className="mt-2 border-t border-slate-100 pt-2">
        <div id="voucher-cell-mode-label" className="mb-1 text-xs font-medium text-slate-600">
          Chữ dài trong ô
        </div>
        <Radio.Group
          aria-labelledby="voucher-cell-mode-label"
          size="small"
          optionType="button"
          value={cellMode}
          onChange={(event) => onCellModeChange(event.target.value as VoucherCellMode)}
          options={[
            { value: 'wrap', label: 'Xuống dòng' },
            { value: 'compact', label: 'Gọn một dòng' },
          ]}
        />
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
        <span className="text-xs text-slate-500">Kéo tiêu đề để đổi vị trí, kéo mép để đổi độ rộng</span>
        <button type="button" onClick={onResetWidths} aria-label="Độ rộng và vị trí cột về mặc định" className="text-xs font-medium text-link hover:underline">
          Về mặc định
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
        <span className="text-xs text-slate-500">Lưu riêng cho bạn</span>
        <button type="button" onClick={onReset} className="text-xs font-medium text-link hover:underline">
          Về mặc định
        </button>
      </div>
    </div>
  );
  return (
    <Popover trigger="click" placement="bottomRight" content={content} title="Cột hiển thị">
      <Button type="button" variant="outline" aria-label="Chọn cột hiển thị">
        <Columns3 aria-hidden /> Cột
      </Button>
    </Popover>
  );
}
