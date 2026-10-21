'use client';

import {
  Circle,
  Hand,
  MousePointer2,
  PenTool,
  Pentagon,
  Slash,
  Square,
  SplinePointer,
  type LucideIcon,
} from 'lucide-react';
import { Fragment } from 'react';
import { IconButton } from './editor-controls';
import { TOOL_KEYS } from './interactions';
import type { EditorTool } from './tool';

interface ToolEntry {
  readonly tool: EditorTool;
  readonly label: string;
  readonly icon: LucideIcon;
}

/** Các nhóm công cụ; mỗi nhóm cách nhau một đường kẻ mảnh. */
const TOOL_GROUPS: readonly (readonly ToolEntry[])[] = [
  [
    { tool: 'select', label: 'Chọn', icon: MousePointer2 },
    { tool: 'node', label: 'Điểm neo', icon: SplinePointer },
  ],
  [{ tool: 'pen', label: 'Bút', icon: PenTool }],
  [
    { tool: 'rect', label: 'Chữ nhật', icon: Square },
    { tool: 'ellipse', label: 'Elip, hình tròn', icon: Circle },
    { tool: 'line', label: 'Đường thẳng', icon: Slash },
    { tool: 'polygon', label: 'Đa giác đều', icon: Pentagon },
  ],
  [{ tool: 'hand', label: 'Bàn tay', icon: Hand }],
];

export function EditorToolbar({ tool, onToolChange }: { tool: EditorTool; onToolChange: (tool: EditorTool) => void }) {
  return (
    <div
      role="toolbar"
      aria-label="Công cụ vẽ"
      aria-orientation="vertical"
      className="flex w-11 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-slate-200 bg-white py-2"
    >
      {TOOL_GROUPS.map((group, index) => (
        <Fragment key={group[0].tool}>
          {index > 0 ? <span aria-hidden="true" className="my-1 h-px w-6 bg-slate-200" /> : null}
          {group.map((entry) => {
            const Icon = entry.icon;
            return (
              <IconButton
                key={entry.tool}
                label={entry.label}
                shortcut={TOOL_KEYS[entry.tool]}
                pressed={tool === entry.tool}
                onClick={() => onToolChange(entry.tool)}
              >
                <Icon className="size-4" />
              </IconButton>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
