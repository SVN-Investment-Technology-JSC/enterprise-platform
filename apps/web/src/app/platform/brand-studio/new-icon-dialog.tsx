'use client';

import { MinimalPopupForm } from '@enterprise-platform/shared-ui';
import { useEffect, useState, type FormEvent } from 'react';

const NAME_MAX = 80;
const DESCRIPTION_MAX = 300;

const FIELD_CLASS =
  'h-10 w-full rounded border border-[#e0e0e0] bg-white px-3 text-[15px] text-[#333333] outline-none transition-colors placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15';

export function NewIconDialog({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setDescription('');
    setError(null);
  }, [isOpen]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Vui lòng nhập tên biểu tượng');
      return;
    }
    onCreate({ name: name.trim(), description: description.trim() });
  };

  return (
    <MinimalPopupForm
      isOpen={isOpen}
      maxWidth={500}
      onClose={onClose}
      subtitle="Biểu tượng mới được thêm vào thư viện SVNDTS và có thể chỉnh sửa ngay sau khi tạo."
      title="Tạo icon mới"
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-[#333333]" htmlFor="new-icon-name">
            Tên biểu tượng <span className="text-red-600">*</span>
          </label>
          <input
            aria-describedby={error ? 'new-icon-name-error' : undefined}
            aria-invalid={error ? true : undefined}
            autoFocus
            className={`${FIELD_CLASS} ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500/15' : ''}`}
            id="new-icon-name"
            maxLength={NAME_MAX}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError(null);
            }}
            placeholder="Ví dụ: Đơn hàng, Quản lý xe, Hợp đồng"
            value={name}
          />
          {error ? (
            <span className="text-xs text-red-600" id="new-icon-name-error" role="alert">
              {error}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-[#333333]" htmlFor="new-icon-description">
            Mô tả mục đích sử dụng
          </label>
          <input
            className={FIELD_CLASS}
            id="new-icon-description"
            maxLength={DESCRIPTION_MAX}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Nhập mô tả ngắn gọn"
            value={description}
          />
          <span className="text-xs text-slate-500">Không bắt buộc. Hiển thị trong danh mục và thẻ xem trước.</span>
        </div>

        <div className="mt-[18px] flex justify-end gap-3 border-t border-[#e5e7eb] pt-4">
          <button
            className="h-10 rounded border border-[#d1d5db] bg-transparent px-4 text-sm font-medium text-[#4b5563] transition-colors hover:bg-[#e5e5e5]"
            onClick={onClose}
            type="button"
          >
            Hủy
          </button>
          <button
            className="h-10 rounded bg-blue-600 px-5 text-sm font-bold !text-white transition-colors hover:bg-blue-700 disabled:bg-blue-300"
            disabled={!name.trim()}
            type="submit"
          >
            Tạo icon
          </button>
        </div>
      </form>
    </MinimalPopupForm>
  );
}
