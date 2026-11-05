'use client';

import { FileArchive, FileImage, FileText, Upload, X } from 'lucide-react';
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import styles from '../workspace.module.scss';
import { Tooltip } from './tooltip';

export interface FilePickerProps {
  readonly files: readonly File[];
  readonly onChange: (files: File[]) => void;
  /** Các loại MIME được nhận; tệp ngoài danh sách bị từ chối ngay tại ô, không đợi tới lúc tải lên. */
  readonly accept: readonly string[];
  readonly maxBytes: number;
  /** Số tệp tối đa. Lớn hơn 1 thì chọn được nhiều tệp một lượt (và thêm dần); mặc định 1 tệp. */
  readonly maxFiles?: number;
  readonly disabled?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

function iconFor(type: string) {
  if (type.startsWith('image/')) return FileImage;
  if (type === 'application/zip') return FileArchive;
  return FileText;
}

const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/**
 * Ô chọn tệp: vùng thả có nét đứt, bấm hoặc kéo tệp vào. Đã chọn thì hiện thẻ tệp (biểu tượng theo loại, tên, dung
 * lượng) kèm nút bỏ. Thay cho `<input type="file">` trần của trình duyệt vốn mỗi nền tảng một kiểu.
 *
 * Một tệp (mặc định): chọn xong vùng thả đổi thành thẻ tệp, có "Đổi tệp". Nhiều tệp (`maxFiles` > 1): vùng thả luôn ở
 * trên để thêm tiếp, các tệp đã chọn xếp thành danh sách bên dưới, bỏ từng tệp được.
 */
export function FilePicker({ files, onChange, accept, maxBytes, maxFiles = 1, disabled }: FilePickerProps) {
  const multiple = maxFiles > 1;
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string>();

  const take = (picked: readonly File[]) => {
    if (picked.length === 0) return;
    const problems: string[] = [];
    const valid: File[] = [];
    for (const next of picked) {
      // Trình duyệt không luôn biết loại tệp (để trống); chỉ chặn khi biết chắc là loại không được nhận.
      if (next.type && !accept.includes(next.type)) problems.push(`"${next.name}": loại tệp chưa được hỗ trợ.`);
      else if (next.size > maxBytes) {
        problems.push(`"${next.name}" (${formatSize(next.size)}) vượt mức tối đa ${formatSize(maxBytes)}.`);
      } else valid.push(next);
    }
    let merged: File[];
    if (multiple) {
      merged = [...files];
      for (const file of valid) if (!merged.some((entry) => sameFile(entry, file))) merged.push(file);
      if (merged.length > maxFiles) {
        problems.push(`Chỉ chọn tối đa ${maxFiles} tệp một lượt.`);
        merged = merged.slice(0, maxFiles);
      }
    } else {
      merged = valid.slice(0, 1);
    }
    setProblem(problems.length > 0 ? problems.slice(0, 3).join(' ') : undefined);
    if (valid.length > 0 || (multiple && merged.length !== files.length)) onChange(merged);
  };

  const open = () => {
    if (!disabled) input.current?.click();
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) take([...(event.dataTransfer.files ?? [])]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };

  const remove = (file: File) => {
    setProblem(undefined);
    onChange(files.filter((entry) => entry !== file));
  };

  const card = (file: File, withReplace: boolean) => {
    const Icon = iconFor(file.type);
    return (
      <div key={`${file.name}:${file.size}:${file.lastModified}`} className={styles.filePickerCard}>
        <span className={styles.filePickerIcon} aria-hidden>
          <Icon size={20} />
        </span>
        <span className={styles.filePickerMeta}>
          <Tooltip content={file.name}>
            <strong>{file.name}</strong>
          </Tooltip>
          <span>{[formatSize(file.size), file.type || undefined].filter(Boolean).join(' · ')}</span>
        </span>
        {withReplace ? (
          <button type="button" className={styles.buttonGhost} disabled={disabled} onClick={open}>
            Đổi tệp
          </button>
        ) : null}
        <button
          type="button"
          className={styles.filePickerRemove}
          aria-label={`Bỏ tệp ${file.name}`}
          disabled={disabled}
          onClick={() => remove(file)}
        >
          <X size={15} aria-hidden />
        </button>
      </div>
    );
  };

  const showDrop = multiple || files.length === 0;
  const compact = multiple && files.length > 0;

  return (
    <div className={styles.filePicker}>
      {/* Style nội tuyến: luật ".field input" của form không được làm lộ ô nhập gốc. */}
      <input
        ref={input}
        type="file"
        multiple={multiple}
        style={{ display: 'none' }}
        accept={accept.join(',')}
        disabled={disabled}
        onChange={(event) => {
          take([...(event.target.files ?? [])]);
          // Cho phép chọn lại đúng tệp đó sau khi đã bỏ.
          event.target.value = '';
        }}
      />
      {showDrop ? (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          aria-label={multiple ? 'Chọn tệp từ máy (được chọn nhiều tệp)' : 'Chọn tệp từ máy'}
          className={[
            styles.filePickerDrop,
            compact ? styles.filePickerDropCompact : '',
            dragging ? styles.filePickerDropOver : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={open}
          onKeyDown={onKeyDown}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className={styles.filePickerIcon} aria-hidden>
            <Upload size={20} />
          </span>
          <span className={styles.filePickerText}>
            {compact ? 'Kéo thêm tệp vào đây hoặc ' : multiple ? 'Kéo các tệp vào đây hoặc ' : 'Kéo tệp vào đây hoặc '}
            <b>chọn từ máy</b>
          </span>
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className={styles.filePickerList}>{files.map((file) => card(file, !multiple))}</div>
      ) : null}
      {multiple && files.length > 0 ? (
        <p className={styles.filePickerCount}>
          Đã chọn {files.length}/{maxFiles} tệp
        </p>
      ) : null}
      {problem ? (
        <p className={styles.filePickerProblem} role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
