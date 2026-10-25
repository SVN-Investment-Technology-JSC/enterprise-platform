'use client';

import { Bold, Italic, Link2, List, ListOrdered, Quote, Underline } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EmojiButton } from '../emoji/emoji-button';
import { normalizeLink } from '../social.model';
import styles from '../social.module.scss';

export interface RichEditorProps {
  /** Chỉ dùng lúc dựng: trình soạn tự giữ nội dung, đổi `initialHtml` sau đó không có tác dụng. */
  readonly initialHtml?: string;
  readonly placeholder?: string;
  readonly onChange: (html: string) => void;
}

interface ToolButton {
  readonly command: string;
  readonly label: string;
  readonly icon: ReactNode;
}

const TOOLS: readonly ToolButton[] = [
  { command: 'bold', label: 'In đậm', icon: <Bold size={15} /> },
  { command: 'italic', label: 'In nghiêng', icon: <Italic size={15} /> },
  { command: 'underline', label: 'Gạch chân', icon: <Underline size={15} /> },
  { command: 'insertUnorderedList', label: 'Danh sách chấm', icon: <List size={15} /> },
  { command: 'insertOrderedList', label: 'Danh sách số', icon: <ListOrdered size={15} /> },
];

/**
 * Trình soạn rich text nhẹ: một vùng `contenteditable` cùng thanh định dạng.
 * HTML sinh ra chỉ là bản nháp; server làm sạch lại trước khi lưu và trả về.
 * Dùng `document.execCommand` vì đây là cách duy nhất không cần thư viện mà vẫn giữ lịch sử hoàn tác của trình duyệt.
 */
export function RichEditor({ initialHtml = '', placeholder, onChange }: RichEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState(false);

  // Chỉ nạp nội dung ban đầu một lần.
  const initial = useRef(initialHtml);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initial.current;
  }, []);

  const emit = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML);
  }, [onChange]);

  const run = (command: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, value);
    emit();
  };

  const rememberSelection = () => {
    const selection = window.getSelection();
    savedRange.current =
      selection && selection.rangeCount > 0 && ref.current?.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;
  };

  const insertEmoji = (emoji: string) => {
    const editor = ref.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (selection) {
      // Chưa từng đặt con trỏ trong ô soạn thì chèn ở cuối nội dung.
      const range = savedRange.current ?? document.createRange();
      if (!savedRange.current) {
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand('insertText', false, emoji);
    rememberSelection();
    emit();
  };

  const openLink = () => {
    rememberSelection();
    setLinkValue('');
    setLinkError(false);
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = normalizeLink(linkValue);
    if (!url) {
      setLinkError(true);
      return;
    }
    ref.current?.focus();
    const selection = window.getSelection();
    if (selection && savedRange.current) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
    if (selection && selection.isCollapsed) {
      document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`);
    } else {
      document.execCommand('createLink', false, url);
    }
    setLinkOpen(false);
    emit();
  };

  return (
    <div className={styles.editor}>
      <div className={styles.editorTools} role="toolbar" aria-label="Định dạng văn bản">
        {TOOLS.map((tool) => (
          <button
            key={tool.command}
            type="button"
            className={styles.editorTool}
            title={tool.label}
            aria-label={tool.label}
            // Giữ vùng chọn trong trình soạn khi bấm nút.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(tool.command)}
          >
            {tool.icon}
          </button>
        ))}
        <button
          type="button"
          className={styles.editorTool}
          title="Chèn liên kết"
          aria-label="Chèn liên kết"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openLink}
        >
          <Link2 size={15} />
        </button>
        <button
          type="button"
          className={styles.editorTool}
          title="Trích dẫn"
          aria-label="Trích dẫn"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => run('formatBlock', 'blockquote')}
        >
          <Quote size={15} />
        </button>
        <EmojiButton className={styles.editorTool} iconSize={15} onBeforeOpen={rememberSelection} onPick={insertEmoji} />
      </div>
      {linkOpen ? (
        <div className={styles.linkBar}>
          <input
            className={styles.input}
            value={linkValue}
            autoFocus
            placeholder="Dán địa chỉ liên kết, ví dụ savina.vn"
            aria-label="Địa chỉ liên kết"
            aria-invalid={linkError}
            onChange={(event) => {
              setLinkValue(event.target.value);
              setLinkError(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
              if (event.key === 'Escape') {
                event.stopPropagation();
                setLinkOpen(false);
              }
            }}
          />
          <button type="button" className={styles.buttonSmall} onClick={applyLink}>
            Chèn
          </button>
          <button type="button" className={styles.buttonSmall} onClick={() => setLinkOpen(false)}>
            Bỏ qua
          </button>
          {linkError ? <span className={styles.fieldError}>Liên kết không hợp lệ.</span> : null}
        </div>
      ) : null}
      <div
        ref={ref}
        className={`${styles.editorArea} ${styles.richBody}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Nội dung bài viết"
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onPaste={(event) => {
          // Dán thành chữ thuần để không kéo theo kiểu chữ và màu của nơi sao chép.
          event.preventDefault();
          document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
        }}
      />
    </div>
  );
}
