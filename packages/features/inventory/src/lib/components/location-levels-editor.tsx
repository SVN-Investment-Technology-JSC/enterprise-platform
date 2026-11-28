'use client';

import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useState } from 'react';
import { SUGGESTED_LOCATION_LEVELS } from '../storage-location.model';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

/**
 * Trình soạn tên các cấp vị trí (Khu, Dãy, Kệ, Tầng, Ô...). Khác danh mục chuỗi thông thường ở chỗ THỨ TỰ là
 * ý nghĩa của dữ liệu: cấp đầu là lớn nhất, nên có nút chuyển lên xuống. Không giới hạn số cấp.
 * Đổi tên hay số cấp không đổi vị trí đã nhập, vì mỗi vị trí đã là một chuỗi hoàn chỉnh.
 */
export function LocationLevelsEditor({
  levels,
  disabled,
  onChange,
}: {
  levels: readonly string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...levels, value]);
    setDraft('');
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= levels.length) return;
    const next = [...levels];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {levels.map((level, index) => (
          <li key={`${index}-${level}`} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-xs font-semibold text-slate-500">Cấp {index + 1}</span>
            <Input
              className="h-8 max-w-xs text-[13px]"
              value={level}
              disabled={disabled}
              maxLength={50}
              aria-label={`Tên cấp ${index + 1}`}
              onChange={(event) => onChange(levels.map((item, at) => (at === index ? event.target.value : item)))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || index === 0}
              aria-label={`Chuyển cấp ${index + 1} lên`}
              onClick={() => move(index, -1)}
            >
              <ArrowUp size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || index === levels.length - 1}
              aria-label={`Chuyển cấp ${index + 1} xuống`}
              onClick={() => move(index, 1)}
            >
              <ArrowDown size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={`Xóa cấp ${index + 1}`}
              onClick={() => onChange(levels.filter((_, at) => at !== index))}
            >
              <X size={14} />
            </Button>
          </li>
        ))}
        {levels.length === 0 ? (
          <li className="py-1 text-sm italic text-slate-400">Chưa chia cấp: vị trí nhập thành một chuỗi tự do.</li>
        ) : null}
      </ol>

      <div className="flex max-w-md items-center gap-2">
        <Input
          value={draft}
          disabled={disabled}
          maxLength={50}
          placeholder="VD: Khu vực, Dãy, Kệ, Tầng, Ô chứa"
          aria-label="Tên cấp mới"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            // Enter là "thêm cấp", không kích hoạt submit của form Cài đặt bọc ngoài.
            event.preventDefault();
            add();
          }}
        />
        <Button type="button" disabled={disabled || !draft.trim()} onClick={add}>
          Thêm cấp
        </Button>
      </div>

      {levels.length === 0 ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onChange([...SUGGESTED_LOCATION_LEVELS])}
          >
            Dùng mẫu gợi ý ({SUGGESTED_LOCATION_LEVELS.join(' / ')})
          </Button>
        </div>
      ) : null}
    </div>
  );
}
