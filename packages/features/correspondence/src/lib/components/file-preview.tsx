'use client';

import type { LetterAttachment } from '@enterprise-platform/contracts-correspondence';
import { toast } from '@enterprise-platform/shared-ui';
import { Download, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { attachmentTicket, downloadAttachment, errorMessage } from '../correspondence-api';
import { formatBytes, previewKind, type PreviewKind } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { readDeck, type Deck, type SlideItem } from '../pptx-preview';

export interface PreviewTarget {
  readonly letterId: string;
  readonly file: LetterAttachment;
}

const TEXT_LIMIT = 2 * 1024 * 1024;
const SHEET_ROWS = 1000;
const SHEET_COLUMNS = 60;

type Loaded =
  | { readonly kind: 'url'; readonly as: 'pdf' | 'image' | 'video' | 'audio'; readonly url: string }
  | { readonly kind: 'text'; readonly text: string; readonly truncated: boolean }
  | { readonly kind: 'docx'; readonly blob: Blob }
  | { readonly kind: 'sheet'; readonly sheets: readonly { readonly name: string; readonly rows: readonly (readonly string[])[]; readonly truncated: boolean }[] }
  | { readonly kind: 'deck'; readonly deck: Deck }
  | { readonly kind: 'none'; readonly message: string };

async function fetchFile(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Không tải được tệp để xem (HTTP ${response.status}).`);
  return response;
}

async function load(kind: PreviewKind, url: string, fileName: string): Promise<Loaded> {
  switch (kind) {
    case 'pdf':
    case 'image':
    case 'video':
    case 'audio':
      return { kind: 'url', as: kind, url };
    case 'text': {
      const blob = await (await fetchFile(url)).blob();
      const text = await blob.slice(0, TEXT_LIMIT).text();
      return { kind: 'text', text, truncated: blob.size > TEXT_LIMIT };
    }
    case 'docx':
      return { kind: 'docx', blob: await (await fetchFile(url)).blob() };
    case 'sheet': {
      const data = await (await fetchFile(url)).arrayBuffer();
      // Nạp thư viện bảng tính khi cần: chỉ người mở bảng tính mới phải tải về.
      const XLSX = await import('xlsx');
      const book = fileName.toLowerCase().endsWith('.csv')
        ? XLSX.read(new TextDecoder().decode(data), { type: 'string' })
        : XLSX.read(data, { type: 'array' });
      return {
        kind: 'sheet',
        sheets: book.SheetNames.map((name) => {
          const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false });
          const truncated = rows.length > SHEET_ROWS || rows.some((row) => row.length > SHEET_COLUMNS);
          return {
            name,
            truncated,
            rows: rows.slice(0, SHEET_ROWS).map((row) => row.slice(0, SHEET_COLUMNS).map((cell) => String(cell ?? ''))),
          };
        }),
      };
    }
    case 'pptx':
      return { kind: 'deck', deck: await readDeck(await (await fetchFile(url)).arrayBuffer()) };
    default:
      return {
        kind: 'none',
        message: 'Định dạng này (tệp Word, PowerPoint đời cũ .doc, .ppt hay tệp nén) chưa xem trực tiếp được. Tải xuống để mở.',
      };
  }
}

/**
 * Xem trước tệp của hồ sơ ngay trong trang, không phải tải về: PDF, ảnh, video, âm thanh;
 * Word (.docx), bảng tính (.xlsx, .xls, .ods, .csv), trình chiếu (.pptx) và văn bản thuần
 * dựng trong trình duyệt. URL lấy ở chế độ xem nên nhật ký kho tài liệu ghi là "xem".
 */
export function FilePreview({ target, onClose }: { readonly target?: PreviewTarget; readonly onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded>();
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState(0);
  const docxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) return undefined;
    setLoaded(undefined);
    setError(undefined);
    setSheet(0);
    let alive = true;
    let disposeDeck: (() => void) | undefined;
    void (async () => {
      try {
        const ticket = await attachmentTicket(target.letterId, target.file.id, 'preview');
        const kind = previewKind(ticket.contentType || target.file.contentType, target.file.fileName);
        const next = await load(kind, ticket.downloadUrl, target.file.fileName);
        if (next.kind === 'deck') disposeDeck = next.deck.dispose;
        if (alive) setLoaded(next);
        else disposeDeck?.();
      } catch (cause) {
        if (alive) {
          setError(
            cause instanceof Error && cause.message
              ? cause.message
              : errorMessage(cause, 'Không mở được bản xem trước. Tải xuống để mở.'),
          );
        }
      }
    })();
    return () => {
      alive = false;
      disposeDeck?.();
    };
  }, [target]);

  // Dựng tệp Word sau khi khung của nó đã gắn vào trang.
  useEffect(() => {
    if (loaded?.kind !== 'docx' || !docxRef.current) return undefined;
    const container = docxRef.current;
    let alive = true;
    void (async () => {
      try {
        const { renderAsync } = await import('docx-preview');
        if (!alive) return;
        container.replaceChildren();
        await renderAsync(loaded.blob, container, undefined, { inWrapper: true, ignoreLastRenderedPageBreak: true, breakPages: true });
      } catch {
        if (alive) setError('Không dựng được tệp Word này. Tải xuống để mở bằng Word.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [loaded]);

  useEffect(() => {
    if (!target) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [target, onClose]);

  if (!target || typeof document === 'undefined') return null;
  const file = target.file;
  const download = () =>
    void downloadAttachment(target.letterId, file.id).catch((cause) => toast.error(errorMessage(cause, 'Không tải được tệp.')));

  return createPortal(
    <div className={styles.previewOverlay} role="presentation">
      <div className={styles.previewPanel} role="dialog" aria-modal="true" aria-label={`Xem trước ${file.fileName}`}>
        <header className={styles.previewHead}>
          <div className={styles.previewTitle}>
            <b title={file.fileName}>{file.fileName}</b>
            <span>
              Phiên bản {file.versionNo} · {formatBytes(file.sizeBytes)}
            </span>
          </div>
          <button type="button" className={styles.buttonGhost} onClick={download}>
            <Download size={14} /> Tải xuống
          </button>
          <button type="button" className={styles.iconButton} aria-label="Đóng xem trước (Esc)" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className={styles.previewBody}>
          {error ? (
            <div className={styles.previewNote}>
              <p role="alert">{error}</p>
              <button type="button" className={styles.buttonPrimary} onClick={download}>
                <Download size={14} /> Tải xuống
              </button>
            </div>
          ) : !loaded ? (
            <p className={styles.previewNote}>Đang mở tệp…</p>
          ) : loaded.kind === 'url' ? (
            loaded.as === 'pdf' ? (
              <iframe className={styles.previewFrame} src={loaded.url} title={file.fileName} />
            ) : loaded.as === 'image' ? (
              <img className={styles.previewImage} src={loaded.url} alt={file.fileName} />
            ) : loaded.as === 'video' ? (
              <video className={styles.previewImage} src={loaded.url} controls />
            ) : (
              <audio className={styles.previewAudio} src={loaded.url} controls />
            )
          ) : loaded.kind === 'text' ? (
            <div className={styles.previewPaper}>
              {loaded.truncated ? <p className={styles.notice}>Tệp dài, chỉ hiện 2 MB đầu. Tải xuống để xem đủ.</p> : null}
              <pre className={styles.previewText}>{loaded.text}</pre>
            </div>
          ) : loaded.kind === 'docx' ? (
            <div ref={docxRef} className={styles.previewDocx} />
          ) : loaded.kind === 'sheet' ? (
            <SheetView sheets={loaded.sheets} active={sheet} onSelect={setSheet} />
          ) : loaded.kind === 'deck' ? (
            <DeckView deck={loaded.deck} />
          ) : (
            <div className={styles.previewNote}>
              <p>{loaded.message}</p>
              <button type="button" className={styles.buttonPrimary} onClick={download}>
                <Download size={14} /> Tải xuống
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SheetView({
  sheets,
  active,
  onSelect,
}: {
  readonly sheets: Extract<Loaded, { kind: 'sheet' }>['sheets'];
  readonly active: number;
  readonly onSelect: (index: number) => void;
}) {
  const sheet = sheets[active];
  if (!sheet) return <p className={styles.previewNote}>Bảng tính trống.</p>;
  const columns = Math.max(1, ...sheet.rows.map((row) => row.length));
  return (
    <div className={styles.sheetWrap}>
      {sheets.length > 1 ? (
        <div className={styles.sheetTabs} role="tablist">
          {sheets.map((item, index) => (
            <button
              key={item.name}
              type="button"
              role="tab"
              aria-selected={index === active}
              className={index === active ? `${styles.chip} ${styles.chipOn}` : styles.chip}
              onClick={() => onSelect(index)}
            >
              {item.name}
            </button>
          ))}
        </div>
      ) : null}
      {sheet.truncated ? (
        <p className={styles.notice}>
          Bảng tính lớn: chỉ hiện {SHEET_ROWS} dòng và {SHEET_COLUMNS} cột đầu. Tải xuống để xem đủ.
        </p>
      ) : null}
      <div className={styles.sheetScroll}>
        <table className={styles.sheetTable}>
          <thead>
            <tr>
              <th />
              {Array.from({ length: columns }, (_, index) => (
                <th key={index}>{columnName(index)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th>{rowIndex + 1}</th>
                {Array.from({ length: columns }, (_, index) => (
                  <td key={index}>{row[index] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {sheet.rows.length === 0 ? <p className={styles.previewNote}>Trang tính trống.</p> : null}
      </div>
    </div>
  );
}

/** A, B, …, Z, AA, AB… */
function columnName(index: number): string {
  let name = '';
  let value = index + 1;
  while (value > 0) {
    const rest = (value - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function DeckView({ deck }: { readonly deck: Deck }) {
  const percent = (value: number, of: number) => `${(value / of) * 100}%`;
  // Cỡ chữ theo bề ngang trang (đơn vị cqw), 1pt = 12700 EMU.
  const fontSize = (pt: number) => `${((pt * 12700) / deck.width) * 100}cqw`;
  const place = (item: SlideItem): CSSProperties => ({
    left: percent(item.x, deck.width),
    top: percent(item.y, deck.height),
    width: percent(item.w, deck.width),
    height: percent(item.h, deck.height),
  });
  return (
    <div className={styles.deck}>
      {deck.total > deck.slides.length ? (
        <p className={styles.notice}>Chỉ hiện {deck.slides.length} trang đầu trong {deck.total} trang.</p>
      ) : null}
      {deck.slides.map((items, index) => (
        <figure key={index} className={styles.slideFrame}>
          <div className={styles.slide} style={{ aspectRatio: `${deck.width} / ${deck.height}` }}>
            {items.map((item, at) =>
              item.kind === 'image' ? (
                item.url ? (
                  <img key={at} className={styles.slideItem} style={place(item)} src={item.url} alt="" />
                ) : (
                  <div key={at} className={`${styles.slideItem} ${styles.slideMissing}`} style={place(item)} />
                )
              ) : item.kind === 'table' ? (
                <div key={at} className={styles.slideItem} style={{ ...place(item), fontSize: fontSize(12) }}>
                  <table className={styles.slideTable}>
                    <tbody>
                      {item.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div key={at} className={`${styles.slideItem} ${styles.slideText}`} style={place(item)}>
                  {item.paragraphs.map((paragraph, paragraphIndex) => (
                    <p key={paragraphIndex} style={{ textAlign: paragraph.align }}>
                      {paragraph.bullet ? '• ' : ''}
                      {paragraph.runs.map((run, runIndex) => (
                        <span
                          key={runIndex}
                          style={{
                            fontSize: fontSize(run.sizePt ?? (item.title ? 32 : 18)),
                            fontWeight: run.bold || item.title ? 700 : undefined,
                            fontStyle: run.italic ? 'italic' : undefined,
                            color: run.color,
                          }}
                        >
                          {run.text}
                        </span>
                      ))}
                    </p>
                  ))}
                </div>
              ),
            )}
          </div>
          <figcaption>Trang {index + 1}</figcaption>
        </figure>
      ))}
    </div>
  );
}
