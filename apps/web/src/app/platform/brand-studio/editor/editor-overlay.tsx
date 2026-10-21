'use client';

import {
  docToScreen,
  flattenGeometry,
  nodeIsSmooth,
  type Guide,
  type IconShape,
  type PathGeometry,
  type Point,
  type Rect,
  type Viewport,
} from '@enterprise-platform/shared-brand-icon';
import { memo, useMemo } from 'react';
import { nodeKey, type PenDraft, type SelectionLayout } from './interactions';

const BLUE = '#2563eb';
const BLUE_SOFT = '#60a5fa';
const GUIDE = '#ec4899';

export interface OverlayHint {
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

export interface NodeOverlayTarget {
  readonly shapeId: string;
  readonly path: PathGeometry;
}

export interface PenOverlay {
  readonly draft: PenDraft;
  /** Con trỏ (toạ độ lưới) để vẽ điểm đang đặt; `null` khi chưa có. */
  readonly hover: Point | null;
  /** Đang ở gần điểm đầu nên bấm sẽ đóng đường. */
  readonly closing: boolean;
}

export interface EditorOverlayProps {
  readonly view: Viewport;
  readonly width: number;
  readonly height: number;
  /** Hình cần viền xanh (đang chọn). */
  readonly selected: readonly IconShape[];
  readonly hover: IconShape | null;
  readonly layout: SelectionLayout | null;
  readonly marquee: Rect | null;
  readonly guides: readonly Guide[];
  readonly hint: OverlayHint | null;
  readonly nodes: readonly NodeOverlayTarget[] | null;
  readonly selectedNodes: ReadonlySet<string>;
  readonly pen: PenOverlay | null;
  /** Đầu mút đường mở có thể nối tiếp bằng bút (toạ độ lưới). */
  readonly endHint: Point | null;
}

/** Chuỗi `d` của đường viền hình theo toạ độ màn hình. */
export function outlineData(shape: IconShape, view: Viewport): string {
  return flattenGeometry(shape.geometry)
    .map((line) => {
      const points = line.points.map((point) => {
        const screen = docToScreen(view, point);
        return `${screen.x.toFixed(1)} ${screen.y.toFixed(1)}`;
      });
      return points.length === 0 ? '' : `M ${points.join(' L ')}${line.closed ? ' Z' : ''}`;
    })
    .join(' ');
}

const Outlines = memo(function Outlines({ shapes, view, stroke }: { shapes: readonly IconShape[]; view: Viewport; stroke: string }) {
  const data = useMemo(() => shapes.map((shape) => ({ id: shape.id, d: outlineData(shape, view) })), [shapes, view]);
  return (
    <g fill="none" stroke={stroke} strokeWidth={1}>
      {data.map((item) => (
        <path key={item.id} d={item.d} />
      ))}
    </g>
  );
});

function Anchor({ x, y, selected, smooth }: { x: number; y: number; selected: boolean; smooth: boolean }) {
  const fill = selected ? BLUE : '#ffffff';
  return smooth ? (
    <circle cx={x} cy={y} r={4} fill={fill} stroke={BLUE} strokeWidth={1.25} />
  ) : (
    <rect x={x - 3.5} y={y - 3.5} width={7} height={7} fill={fill} stroke={BLUE} strokeWidth={1.25} />
  );
}

function NodesLayer({
  targets,
  view,
  selected,
}: {
  targets: readonly NodeOverlayTarget[];
  view: Viewport;
  selected: ReadonlySet<string>;
}) {
  return (
    <g>
      {targets.map((target) => (
        <g key={target.shapeId}>
          {target.path.subpaths.map((sub, subIndex) =>
            sub.nodes.map((node, index) => {
              const isSelected = selected.has(nodeKey(target.shapeId, subIndex, index));
              const anchor = docToScreen(view, node);
              const handles = isSelected
                ? (['hin', 'hout'] as const).flatMap((kind) => {
                    const position = node[kind];
                    return position && (position.x !== node.x || position.y !== node.y) ? [{ kind, at: docToScreen(view, position) }] : [];
                  })
                : [];
              return (
                <g key={`${subIndex}:${index}`}>
                  {handles.map((handle) => (
                    <g key={handle.kind}>
                      <line x1={anchor.x} y1={anchor.y} x2={handle.at.x} y2={handle.at.y} stroke={BLUE_SOFT} strokeWidth={1} />
                      <circle cx={handle.at.x} cy={handle.at.y} r={3.5} fill="#ffffff" stroke={BLUE} strokeWidth={1.25} />
                    </g>
                  ))}
                  <Anchor x={anchor.x} y={anchor.y} selected={isSelected} smooth={nodeIsSmooth(node)} />
                </g>
              );
            }),
          )}
        </g>
      ))}
    </g>
  );
}

function SelectionFrame({ layout }: { layout: SelectionLayout }) {
  const { frame, handles, rotate } = layout;
  return (
    <g>
      <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} fill="none" stroke={BLUE} strokeWidth={1} />
      {rotate ? (
        <g>
          <line x1={frame.x + frame.width / 2} y1={frame.y} x2={rotate.x} y2={rotate.y} stroke={BLUE} strokeWidth={1} />
          <circle cx={rotate.x} cy={rotate.y} r={5} fill="#ffffff" stroke={BLUE} strokeWidth={1.25} />
          <path
            d={`M ${rotate.x - 2.2} ${rotate.y - 0.4} A 2.4 2.4 0 1 1 ${rotate.x + 1.4} ${rotate.y + 1.9}`}
            fill="none"
            stroke={BLUE}
            strokeWidth={1}
            strokeLinecap="round"
          />
        </g>
      ) : null}
      {handles.map((handle) => (
        <rect key={handle.id} x={handle.x - 4} y={handle.y - 4} width={8} height={8} rx={1} fill="#ffffff" stroke={BLUE} strokeWidth={1.25} />
      ))}
    </g>
  );
}

function HintLabel({ hint }: { hint: OverlayHint }) {
  const width = Math.max(28, hint.text.length * 6.4 + 12);
  return (
    <g>
      <rect x={hint.x} y={hint.y} width={width} height={20} rx={4} fill="#0f172a" fillOpacity={0.88} />
      <text x={hint.x + width / 2} y={hint.y + 14} textAnchor="middle" fontSize={11} fill="#ffffff" fontFamily="ui-sans-serif, system-ui, sans-serif">
        {hint.text}
      </text>
    </g>
  );
}

/**
 * Lớp phủ theo toạ độ màn hình (tay cầm, điểm neo, khung quét, đường dóng luôn mảnh và cùng cỡ dù phóng to bao nhiêu).
 * Không nhận sự kiện chuột; toàn bộ tương tác do `EditorCanvas` xử lý.
 */
export function EditorOverlay({
  view,
  width,
  height,
  selected,
  hover,
  layout,
  marquee,
  guides,
  hint,
  nodes,
  selectedNodes,
  pen,
  endHint,
}: EditorOverlayProps) {
  const hovered = useMemo(() => (hover ? [hover] : []), [hover]);
  const marqueeScreen = marquee
    ? (() => {
        const topLeft = docToScreen(view, { x: marquee.x, y: marquee.y });
        return { x: topLeft.x, y: topLeft.y, width: marquee.width * view.zoom, height: marquee.height * view.zoom };
      })()
    : null;

  return (
    <g pointerEvents="none">
      {hovered.length > 0 ? <Outlines shapes={hovered} view={view} stroke={BLUE_SOFT} /> : null}
      {selected.length > 0 ? <Outlines shapes={selected} view={view} stroke={BLUE} /> : null}
      {layout ? <SelectionFrame layout={layout} /> : null}
      {nodes ? <NodesLayer targets={nodes} view={view} selected={selectedNodes} /> : null}

      {guides.map((guide) => {
        if (guide.axis === 'x') {
          const x = docToScreen(view, { x: guide.value, y: 0 }).x;
          return <line key={`x${guide.value}`} x1={x} y1={0} x2={x} y2={height} stroke={GUIDE} strokeWidth={1} />;
        }
        const y = docToScreen(view, { x: 0, y: guide.value }).y;
        return <line key={`y${guide.value}`} x1={0} y1={y} x2={width} y2={y} stroke={GUIDE} strokeWidth={1} />;
      })}

      {pen
        ? pen.draft.nodes.map((node, index) => {
            const at = docToScreen(view, node);
            const first = index === 0;
            return (
              <g key={index}>
                {first && pen.closing ? <circle cx={at.x} cy={at.y} r={8} fill="none" stroke={BLUE} strokeWidth={1.25} /> : null}
                <Anchor x={at.x} y={at.y} selected={index === pen.draft.nodes.length - 1} smooth={nodeIsSmooth(node)} />
              </g>
            );
          })
        : null}
      {endHint
        ? (() => {
            const at = docToScreen(view, endHint);
            return <circle cx={at.x} cy={at.y} r={8} fill="none" stroke={BLUE} strokeWidth={1.25} strokeDasharray="2 2" />;
          })()
        : null}

      {marqueeScreen ? (
        <rect
          x={marqueeScreen.x}
          y={marqueeScreen.y}
          width={marqueeScreen.width}
          height={marqueeScreen.height}
          fill={BLUE}
          fillOpacity={0.08}
          stroke={BLUE}
          strokeWidth={1}
        />
      ) : null}
      {hint ? <HintLabel hint={hint} /> : null}
    </g>
  );
}
