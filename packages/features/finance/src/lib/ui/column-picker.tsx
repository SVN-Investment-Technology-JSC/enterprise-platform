'use client';

import { Checkbox, Popover } from 'antd';
import { Columns3 } from 'lucide-react';
import type { VoucherColumnDef } from '../voucher-list-columns';
import { Button } from './button';

/**
 * Chọn cột hiển thị của danh sách (cấu hình riêng từng người dùng). Bật/tắt cột áp dụng ngay; cột bắt buộc không tắt được.
 */
export function ColumnPicker({
  catalog,
  visible,
  onChange,
  onReset,
}: {
  catalog: readonly VoucherColumnDef[];
  visible: ReadonlySet<string>;
  onChange: (keys: string[]) => void;
  onReset: () => void;
}) {
  const toggle = (key: string, on: boolean) => {
    const next = catalog.filter((column) => column.required || (column.key === key ? on : visible.has(column.key))).map((column) => column.key);
    onChange(next);
  };
  const content = (
    <div className="w-60" role="group" aria-label="Cột hiển thị">
      <ul className="max-h-80 space-y-1 overflow-y-auto">
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
