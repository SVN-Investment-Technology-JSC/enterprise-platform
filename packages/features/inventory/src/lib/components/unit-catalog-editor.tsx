'use client';

import { X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';

/**
 * Trình soạn một DANH MỤC CHUỖI: đơn vị tính, tình trạng, loại vật tư, vị trí…
 *
 * Bốn danh mục đó khác nhau ở nội dung nhưng giống hệt nhau ở thao tác — thêm,
 * xoá, chặn trùng — nên dùng chung một trình soạn. Chữ hiển thị phải truyền vào:
 * bản trước viết cứng "đơn vị", nên danh mục Tình trạng cũng hiện "Chưa có đơn
 * vị nào" và gợi ý "VD: Tấn, Cuộn, Bao".
 *
 * Giá trị đang được dùng thì KHÔNG cho xoá. Xoá đi thì form không chọn lại được
 * giá trị đó, và mọi lần sửa bản ghi cũ sẽ âm thầm đổi nó sang giá trị khác.
 */
export function UnitCatalogEditor({
  units,
  usedUnits,
  disabled,
  noun = 'đơn vị',
  placeholder = 'VD: Tấn, Cuộn, Bao',
  onChange,
}: {
  units: readonly string[];
  /** Giá trị đang được ít nhất một bản ghi dùng. */
  usedUnits: ReadonlySet<string>;
  disabled?: boolean;
  /** Tên gọi của thứ đang khai, dùng trong câu trống và nhãn trợ năng. */
  noun?: string;
  placeholder?: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    // So sánh không phân biệt hoa thường: thêm "cái" khi đã có "Cái" chính là
    // cái lỗi mà danh mục này sinh ra để chặn.
    if (units.some((unit) => unit.toLowerCase() === value.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...units, value]);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex min-h-[2.2rem] list-none flex-wrap items-center gap-[0.45rem] p-0">
        {units.map((unit) => {
          const inUse = usedUnits.has(unit);
          return (
            <li
              key={unit}
              className={cn(
                'inline-flex items-center gap-[0.4rem] rounded-full border px-[0.65rem] py-1 text-sm font-medium transition-all',
                inUse
                  ? 'border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100'
                  : 'border-slate-200 bg-slate-100 text-slate-800 hover:border-slate-300 hover:bg-slate-200',
              )}
            >
              <span>{unit}</span>
              {inUse ? (
                <span
                  className="rounded-full border border-blue-200 bg-blue-100 px-[0.35rem] py-[0.05rem] text-xs font-semibold not-italic text-blue-800"
                  title={`Đang có vật tư dùng ${noun} này`}>
                  đang dùng
                </span>
              ) : null}
              <button
                type="button"
                className="ml-[0.1rem] inline-flex size-4 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-slate-500 transition-all hover:enabled:bg-red-100 hover:enabled:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={disabled || inUse}
                aria-label={`Xoá ${noun} ${unit}`}
                title={
                  inUse ? `Đang có vật tư dùng ${noun} này nên không xoá được.` : `Xoá ${noun}`
                }
                onClick={() => onChange(units.filter((item) => item !== unit))}
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </li>
          );
        })}
        {units.length === 0 ? (
          <li className="py-1 text-sm italic text-slate-400">Chưa khai {noun} nào.</li>
        ) : null}
      </ul>

      <div className="flex max-w-md items-center gap-2">
        <Input
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={`${noun} mới`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            // Form Cài đặt bọc ngoài có nút Lưu riêng; Enter ở đây phải là
            // "thêm dòng", không được kích hoạt submit của form đó.
            event.preventDefault();
            add();
          }}
        />
        <Button type="button" disabled={disabled || !draft.trim()} onClick={add}>
          Thêm
        </Button>
      </div>
    </div>
  );
}
