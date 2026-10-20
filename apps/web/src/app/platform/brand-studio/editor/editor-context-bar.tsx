'use client';

import { CircleDot, Link2, Minus, Plus, Trash2, Unlink2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton, VerticalRule } from './editor-controls';
import { MAX_POLYGON_SIDES, MIN_POLYGON_SIDES } from './interactions';
import type { EditorTool } from './tool';

export interface NodeContext {
  /** Số điểm neo đang chọn. */
  readonly selectedCount: number;
  /** Đường đang sửa đang đóng hay mở; `null` khi không có đường nào có thể đóng/mở (dưới 3 điểm). */
  readonly closed: boolean | null;
  readonly onToggleClosed: () => void;
  readonly onToggleSmooth: () => void;
  readonly onDelete: () => void;
}

export interface EditorContextBarProps {
  readonly tool: EditorTool;
  readonly polygonSides: number;
  readonly onPolygonSidesChange: (sides: number) => void;
  /** Đang vẽ dở một đường bằng bút. */
  readonly penDrawing: boolean;
  readonly node: NodeContext | null;
}

/** Thanh nhỏ nổi trên canvas, hiện các tuỳ chọn của công cụ đang dùng. Không có gì để hiện thì không vẽ gì. */
export function EditorContextBar({ tool, polygonSides, onPolygonSidesChange, penDrawing, node }: EditorContextBarProps) {
  let content: ReactNode = null;

  if (tool === 'polygon') {
    content = (
      <>
        <span className="px-1 text-xs text-slate-500">Số cạnh</span>
        <IconButton
          label="Bớt một cạnh"
          shortcut="Xuống"
          size="sm"
          disabled={polygonSides <= MIN_POLYGON_SIDES}
          onClick={() => onPolygonSidesChange(polygonSides - 1)}
        >
          <Minus className="size-3.5" />
        </IconButton>
        <span aria-live="polite" className="w-5 text-center text-sm font-medium tabular-nums text-slate-900">
          {polygonSides}
        </span>
        <IconButton
          label="Thêm một cạnh"
          shortcut="Lên"
          size="sm"
          disabled={polygonSides >= MAX_POLYGON_SIDES}
          onClick={() => onPolygonSidesChange(polygonSides + 1)}
        >
          <Plus className="size-3.5" />
        </IconButton>
      </>
    );
  } else if (tool === 'pen' && penDrawing) {
    content = <span className="px-1.5 text-xs text-slate-500">Enter: xong. Esc: huỷ. Bấm điểm đầu: đóng đường.</span>;
  } else if (tool === 'node' && node) {
    content = (
      <>
        {node.closed !== null ? (
          <IconButton label={node.closed ? 'Mở đường' : 'Đóng đường'} size="sm" onClick={node.onToggleClosed}>
            {node.closed ? <Unlink2 className="size-3.5" /> : <Link2 className="size-3.5" />}
          </IconButton>
        ) : null}
        {node.selectedCount > 0 ? (
          <>
            {node.closed !== null ? <VerticalRule /> : null}
            <IconButton label="Đổi góc nhọn / trơn (nhấp đôi điểm)" size="sm" onClick={node.onToggleSmooth}>
              <CircleDot className="size-3.5" />
            </IconButton>
            <IconButton label="Xoá điểm" shortcut="Delete" size="sm" onClick={node.onDelete}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </>
        ) : null}
        {node.closed === null && node.selectedCount === 0 ? <span className="px-1.5 text-xs text-slate-500">Nhấp đôi vào đoạn để thêm điểm.</span> : null}
      </>
    );
  }

  if (!content) return null;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-slate-200 bg-white/95 px-1.5 py-1 shadow-sm backdrop-blur">
      {content}
    </div>
  );
}
