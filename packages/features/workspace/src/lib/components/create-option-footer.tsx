'use client';

import { useState, type KeyboardEvent } from 'react';
import styles from '../workspace.module.scss';

/** Cấu hình ô "thêm mục mới" ở cuối danh sách xổ ra của một ô chọn. */
export interface CreateOption {
  readonly namePlaceholder: string;
  /** Có thì có thêm ô nhập mã ngắn (tuỳ chọn), cùng hàng với ô tên. */
  readonly codePlaceholder?: string;
  /** Tên đầy đủ của ô mã cho trình đọc màn hình, khi chữ gợi ý trong ô quá ngắn. */
  readonly codeLabel?: string;
  /** Chữ trên nút (ngắn, vd "Thêm"). */
  readonly addLabel: string;
  /** Tên đầy đủ của nút cho trình đọc màn hình và chú giải, vd "Thêm nhóm". */
  readonly addTitle?: string;
  /** Tạo mục mới; ném lỗi (có `message`) thì lỗi hiện ngay dưới ô nhập. Trả về giá trị của mục vừa tạo. */
  readonly onCreate: (name: string, code: string) => Promise<string>;
}

/** Chân danh sách: ô tên, ô mã và nút thêm trên MỘT hàng; Enter ở một trong hai ô cũng thêm. */
export function CreateOptionFooter({
  create,
  onCreated,
}: {
  create: CreateOption;
  onCreated: (value: string) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) {
      setError('Nhập tên trước khi thêm.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const created = await create.onCreate(name.trim(), code.trim());
      setName('');
      setCode('');
      onCreated(created);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không thêm được.');
    } finally {
      setBusy(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter ở đây là thêm mục, không để lọt ra ngoài thành "chọn mục đang sáng" hay gửi form.
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    void submit();
  };

  return (
    <div className={styles.chipCreate}>
      <input
        className={styles.chipCreateName}
        value={name}
        maxLength={80}
        placeholder={create.namePlaceholder}
        aria-label={create.namePlaceholder}
        disabled={busy}
        onChange={(event) => {
          setName(event.target.value);
          setError(undefined);
        }}
        onKeyDown={onKeyDown}
      />
      {create.codePlaceholder ? (
        <input
          className={styles.chipCreateCode}
          value={code}
          maxLength={16}
          placeholder={create.codePlaceholder}
          aria-label={create.codeLabel ?? create.codePlaceholder}
          disabled={busy}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={onKeyDown}
        />
      ) : null}
      <button
        type="button"
        className={styles.chipCreateAdd}
        aria-label={create.addTitle ?? create.addLabel}
        title={create.addTitle}
        disabled={busy}
        onClick={() => void submit()}
      >
        {create.addLabel}
      </button>
      {error ? (
        <p role="alert" className={styles.chipCreateError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
