'use client';

import type { IconDocument } from '@enterprise-platform/shared-brand-icon';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import {
  ArrowLeft,
  Contrast,
  Crosshair,
  Download,
  Grid3x3,
  Link2,
  LoaderCircle,
  Magnet,
  Palette,
  Redo2,
  Save,
  Scan,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { asRoute, LIBRARY_PATH } from '../library/routes';
import type { ServerIconInfo } from '../store';
import { IconButton, VerticalRule } from './editor-controls';
import type { DisplayMode } from './tool';

export interface EditorTopbarProps {
  readonly doc: IconDocument;
  /** Có thay đổi chưa lưu. */
  readonly dirty: boolean;
  /** Icon chưa từng được lưu vào thư viện. */
  readonly isNew: boolean;
  readonly saving: boolean;
  /** Phiên bản trên máy chủ; null khi icon lưu cục bộ hoặc chưa có trên máy chủ. */
  readonly serverInfo?: ServerIconInfo | null;
  /** Đang gửi yêu cầu phát hành. */
  readonly publishing?: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly zoomPercent: number;
  readonly showGrid: boolean;
  readonly snapGrid: boolean;
  readonly snapObjects: boolean;
  readonly displayMode: DisplayMode;
  readonly onRename: (name: string) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFit: () => void;
  readonly onShowGridChange: (value: boolean) => void;
  readonly onSnapGridChange: (value: boolean) => void;
  readonly onSnapObjectsChange: (value: boolean) => void;
  readonly onDisplayModeChange: (mode: DisplayMode) => void;
  readonly onExport: () => void;
  readonly onSave: () => void;
  /** Phát hành phiên bản đã lưu mới nhất (chỉ hiện khi icon có trên máy chủ). */
  readonly onPublish?: () => void;
  /** Chép đường dẫn SVG công khai (chỉ hiện khi icon đã phát hành). */
  readonly onCopyLink?: () => void;
}

const NAME_MAX = 80;

/** Ô tên sửa tại chỗ: gõ thoải mái, chốt khi rời ô hoặc nhấn Enter, Esc để bỏ. */
function NameField({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);

  const commit = () => {
    const next = draft.trim().slice(0, NAME_MAX);
    if (next && next !== name) onCommit(next);
    else setDraft(name);
  };

  return (
    <input
      aria-label="Tên icon"
      className="h-8 w-44 min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm font-medium text-slate-900 outline-none transition-colors hover:border-slate-200 focus:border-blue-500 focus:bg-white sm:w-56"
      maxLength={NAME_MAX}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(name);
          event.currentTarget.blur();
        }
      }}
      placeholder="Tên icon"
      value={draft}
    />
  );
}

const CHIP = 'rounded px-1.5 py-0.5 text-[11px] font-medium';

/**
 * Trạng thái của icon. Icon có trên máy chủ thì hiện phiên bản đã lưu và phiên bản đang phát hành (lấy từ máy chủ,
 * không lấy từ tài liệu đang sửa); còn lại hiện nháp hoặc đã phát hành theo tài liệu.
 */
function StatusChips({ doc, unsaved, info }: { doc: IconDocument; unsaved: boolean; info: ServerIconInfo | null }) {
  const published = info ? info.publishedVersion !== null : doc.status === 'published';
  let label = published ? 'Đã phát hành' : 'Nháp';
  if (info && info.publishedVersion !== null) label = `Đã phát hành v${info.publishedVersion}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {info ? (
        <span className={`${CHIP} bg-slate-100 text-slate-600 tabular-nums`} title="Phiên bản đã lưu trên máy chủ">
          v{info.version}
        </span>
      ) : null}
      <span className={`${CHIP} ${published ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
        {label}
      </span>
      {info?.hasUnpublishedChanges ? <span className={`${CHIP} bg-amber-50 text-amber-700`}>Có thay đổi chưa phát hành</span> : null}
      {unsaved ? (
        <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />
          Chưa lưu
        </span>
      ) : null}
    </div>
  );
}

function BackButton({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const href = asRoute(LIBRARY_PATH);
  const className =
    'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors outline-none hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500/60';

  if (!dirty) {
    return (
      <Link aria-label="Về thư viện" className={className} href={href} title="Về thư viện">
        <ArrowLeft className="size-4" />
      </Link>
    );
  }
  return (
    <Popconfirm
      cancelText="Ở lại"
      description="Thay đổi chưa lưu sẽ mất."
      okText="Rời đi"
      okType="danger"
      onConfirm={() => router.push(href)}
      placement="bottom-start"
      title="Rời trình thiết kế?"
    >
      <button aria-label="Về thư viện" className={className} title="Về thư viện" type="button">
        <ArrowLeft className="size-4" />
      </button>
    </Popconfirm>
  );
}

/** Thanh trên của trình thiết kế: tên, trạng thái, hoàn tác, thu phóng, công tắc lưới/bắt dính, chế độ màu, xuất và lưu. */
export function EditorTopbar(props: EditorTopbarProps) {
  const { doc, dirty, isNew, saving } = props;
  const unsaved = dirty || isNew;
  const info = props.serverInfo ?? null;
  // Chỉ phát hành được bản đã lưu: còn thay đổi chưa lưu thì phải lưu trước.
  const canPublish = info !== null && !unsaved && (info.publishedVersion === null || info.hasUnpublishedChanges) && props.onPublish !== undefined;

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-1 gap-y-1 border-b border-slate-200 bg-white px-2 py-1">
      <BackButton dirty={dirty} />
      <NameField name={doc.name} onCommit={props.onRename} />
      <StatusChips doc={doc} info={info} unsaved={unsaved} />

      <div className="ml-auto flex flex-wrap items-center gap-0.5">
        <IconButton disabled={!props.canUndo} label="Hoàn tác" onClick={props.onUndo} shortcut="Ctrl+Z">
          <Undo2 className="size-4" />
        </IconButton>
        <IconButton disabled={!props.canRedo} label="Làm lại" onClick={props.onRedo} shortcut="Ctrl+Y">
          <Redo2 className="size-4" />
        </IconButton>
        <VerticalRule />

        <IconButton label="Thu nhỏ" onClick={props.onZoomOut} shortcut="-">
          <ZoomOut className="size-4" />
        </IconButton>
        <span aria-label="Mức phóng to" className="w-11 text-center text-xs tabular-nums text-slate-600">
          {props.zoomPercent}%
        </span>
        <IconButton label="Phóng to" onClick={props.onZoomIn} shortcut="+">
          <ZoomIn className="size-4" />
        </IconButton>
        <IconButton label="Vừa khung" onClick={props.onFit} shortcut="0">
          <Scan className="size-4" />
        </IconButton>
        <VerticalRule />

        <IconButton label="Hiện lưới" onClick={() => props.onShowGridChange(!props.showGrid)} pressed={props.showGrid}>
          <Grid3x3 className="size-4" />
        </IconButton>
        <IconButton label="Bắt dính lưới" onClick={() => props.onSnapGridChange(!props.snapGrid)} pressed={props.snapGrid}>
          <Magnet className="size-4" />
        </IconButton>
        <IconButton label="Bắt dính vào hình khác" onClick={() => props.onSnapObjectsChange(!props.snapObjects)} pressed={props.snapObjects}>
          <Crosshair className="size-4" />
        </IconButton>
        <VerticalRule />

        <IconButton
          label="Hiện màu thương hiệu"
          onClick={() => props.onDisplayModeChange('brand')}
          pressed={props.displayMode === 'brand'}
        >
          <Palette className="size-4" />
        </IconButton>
        <IconButton
          label="Hiện một màu (currentColor)"
          onClick={() => props.onDisplayModeChange('currentColor')}
          pressed={props.displayMode === 'currentColor'}
        >
          <Contrast className="size-4" />
        </IconButton>
        <VerticalRule />

        {info?.publicSvgUrl && props.onCopyLink ? (
          <IconButton label="Chép đường dẫn SVG công khai" onClick={props.onCopyLink}>
            <Link2 className="size-4" />
          </IconButton>
        ) : null}
        {canPublish ? (
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-emerald-700 transition-colors outline-none hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:pointer-events-none disabled:opacity-50"
            disabled={props.publishing}
            onClick={props.onPublish}
            title="Phát hành phiên bản đã lưu mới nhất"
            type="button"
          >
            {props.publishing ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Phát hành
          </button>
        ) : null}
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-slate-700 transition-colors outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500/60"
          onClick={props.onExport}
          title="Xuất SVG, TSX, sprite"
          type="button"
        >
          <Download className="size-4" />
          Xuất
        </button>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-medium text-white transition-colors outline-none hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:pointer-events-none disabled:opacity-50"
          disabled={saving || !unsaved}
          onClick={props.onSave}
          title="Lưu (Ctrl+S)"
          type="button"
        >
          {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          Lưu
        </button>
      </div>
    </div>
  );
}
