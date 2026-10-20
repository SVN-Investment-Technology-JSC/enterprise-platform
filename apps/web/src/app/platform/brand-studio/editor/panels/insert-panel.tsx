'use client';

import {
  FRAME_KINDS,
  FRAME_LABELS,
  looksLikeSvgMarkup,
  type FrameKind,
  type GlyphTemplate,
  type IconShape,
} from '@enterprise-platform/shared-brand-icon';
import { Circle, Minus, Pentagon, Plus, Square, Star, Upload } from 'lucide-react';
import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { cn } from '@/lib/utils';
import { FOCUS_RING, IconButton, Section } from '../../components/controls';
import { formatDecimal, NumberField } from '../../components/number-field';
import {
  analyzeSvg,
  checkSvgFile,
  clampSides,
  DEFAULT_SIDES,
  FRAME_PREVIEW_PATHS,
  frameShape,
  glyphShape,
  glyphsByGroup,
  importForInsert,
  insertBehind,
  MAX_SIDES,
  MIN_SIDES,
  quickShape,
  readFileAsText,
  trimWarnings,
  type QuickShapeKind,
} from './insert-model';
import { defaultStrokeWidth } from './stroke-width';
import type { EditorPanelProps } from './types';

const QUICK_SHAPES: ReadonlyArray<{ kind: QuickShapeKind; label: string; icon: typeof Square }> = [
  { kind: 'rect', label: 'Chèn hình chữ nhật', icon: Square },
  { kind: 'ellipse', label: 'Chèn hình tròn', icon: Circle },
  { kind: 'line', label: 'Chèn đường thẳng', icon: Minus },
  { kind: 'polygon', label: 'Chèn đa giác', icon: Pentagon },
  { kind: 'star', label: 'Chèn ngôi sao', icon: Star },
];

const TILE =
  'flex aspect-square items-center justify-center rounded border border-slate-200 bg-white text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700';

function GlyphPreview({ template }: { template: GlyphTemplate }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-6" aria-hidden="true">
      <path d={template.path} />
    </svg>
  );
}

function FramePreview({ kind }: { kind: FrameKind }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" className="size-6" aria-hidden="true">
      <path d={FRAME_PREVIEW_PATHS[kind]} />
    </svg>
  );
}

/** Bảng Chèn: khung mẫu, hình nhanh, thư viện hình mẫu và nhập SVG (chọn tệp, dán mã, kéo thả). */
export function InsertPanel({ state, dispatch, rules }: EditorPanelProps) {
  const { doc } = state;
  const strokeWidth = defaultStrokeWidth(rules.allowedStrokeWidths);
  const groups = useMemo(() => glyphsByGroup(), []);

  const [sides, setSides] = useState(DEFAULT_SIDES);
  const [source, setSourceText] = useState('');
  const [normalizeChoice, setNormalizeChoice] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const analysis = useMemo(() => analyzeSvg(source, doc.size, rules), [source, doc.size, rules]);
  const dominant = analysis.result?.dominantStrokeWidth ?? null;
  const normalize = dominant !== null && (normalizeChoice ?? analysis.deviates);
  const warnings = trimWarnings(analysis.result?.warnings ?? []);

  const setSource = (text: string) => {
    setSourceText(text);
    setNormalizeChoice(null);
    setProblem(null);
    setNote(null);
  };

  const add = (shape: IconShape | null) => {
    if (shape) dispatch({ type: 'addShapes', shapes: [shape] });
  };

  const loadFile = async (file: File) => {
    const reason = checkSvgFile(file);
    if (reason) {
      setProblem(reason);
      setNote(null);
      return;
    }
    try {
      setSource(await readFileAsText(file));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Không đọc được tệp.');
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text');
    if (!looksLikeSvgMarkup(text)) return;
    event.preventDefault();
    setSource(text);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void loadFile(file);
      return;
    }
    const text = event.dataTransfer.getData('text');
    if (looksLikeSvgMarkup(text)) setSource(text);
  };

  const insertSvg = () => {
    if (!analysis.result) return;
    try {
      const result = normalize ? importForInsert(source, doc.size, rules, true) : analysis.result;
      dispatch({ type: 'addShapes', shapes: result.shapes });
      setSourceText('');
      setNormalizeChoice(null);
      setProblem(null);
      setNote(`Đã chèn ${result.shapes.length} hình.`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Không chèn được SVG.');
    }
  };

  const shownProblem = problem ?? analysis.error;

  return (
    <div className="text-xs text-slate-700">
      <Section title="Khung">
        <div className="grid grid-cols-5 gap-1.5">
          {FRAME_KINDS.map((kind) => {
            const name = FRAME_LABELS[kind].toLowerCase();
            return (
              <button
                key={kind}
                type="button"
                title={`Khung ${name}`}
                aria-label={`Chèn khung ${name}`}
                onClick={() => {
                  for (const action of insertBehind([frameShape(kind, doc.size, rules)])) dispatch(action);
                }}
                className={cn(TILE, FOCUS_RING)}
              >
                <FramePreview kind={kind} />
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Hình">
        <div className="flex items-center gap-0.5">
          {QUICK_SHAPES.map(({ kind, label, icon: Icon }) => (
            <IconButton key={kind} label={label} onClick={() => add(quickShape(kind, { size: doc.size, strokeWidth, sides }))}>
              <Icon />
            </IconButton>
          ))}
          <NumberField
            label="Số cạnh của đa giác, số cánh của ngôi sao"
            prefix="Cạnh"
            value={sides}
            min={MIN_SIDES}
            max={MAX_SIDES}
            step={1}
            digits={0}
            className="ml-auto w-[76px]"
            onCommit={(value) => setSides(clampSides(value))}
          />
        </div>
      </Section>

      <Section title="Hình mẫu">
        {groups.map(({ group, items }) => (
          <div key={group}>
            <p className="mb-1 text-[10px] text-slate-400">{group}</p>
            <div className="grid grid-cols-6 gap-1">
              {items.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  title={template.name}
                  aria-label={`Chèn hình mẫu ${template.name}`}
                  onClick={() => add(glyphShape(template, doc.size, strokeWidth))}
                  className={cn(TILE, FOCUS_RING)}
                >
                  <GlyphPreview template={template} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Nhập SVG">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn('space-y-2 rounded border border-dashed border-transparent', dragging && 'border-blue-400 bg-blue-50/60')}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50',
                FOCUS_RING,
              )}
            >
              <Upload className="size-3.5" aria-hidden="true" />
              Chọn tệp SVG
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".svg,image/svg+xml"
              aria-label="Tệp SVG"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void loadFile(file);
              }}
            />
          </div>
          <textarea
            aria-label="Mã SVG"
            title="Dán mã SVG hoặc thả tệp .svg vào đây"
            placeholder="Dán mã SVG hoặc thả tệp vào đây"
            rows={3}
            spellCheck={false}
            value={source}
            onPaste={onPaste}
            onChange={(event) => setSource(event.target.value)}
            className="w-full resize-none rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-[11px] leading-snug text-slate-800 outline-none placeholder:font-sans placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />

          {analysis.result ? (
            <div className="space-y-1.5">
              <p className="text-[11px] text-slate-600">
                {analysis.result.shapes.length} hình
                {dominant !== null ? <span> · nét {formatDecimal(dominant, 2)}</span> : null}
                {analysis.deviates ? <span className="text-amber-700"> · lệch quy chuẩn</span> : null}
              </p>
              {dominant !== null ? (
                <label
                  className="flex items-center gap-1.5 text-[11px] text-slate-600"
                  title={`Đưa mọi nét về ${formatDecimal(defaultStrokeWidth(rules.allowedStrokeWidths), 2)}, theo bộ độ dày cho phép`}
                >
                  <input
                    type="checkbox"
                    checked={normalize}
                    onChange={(event) => setNormalizeChoice(event.target.checked)}
                    className="size-3.5 shrink-0 accent-blue-600"
                  />
                  Chuẩn hoá nét theo quy chuẩn
                </label>
              ) : null}
              <button
                type="button"
                onClick={insertSvg}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded bg-blue-600 px-3 text-[11px] font-medium text-white transition-colors hover:bg-blue-700',
                  FOCUS_RING,
                )}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Chèn vào icon
              </button>
            </div>
          ) : null}

          {warnings.shown.length > 0 ? (
            <ul className="space-y-0.5 text-[11px] text-amber-700">
              {warnings.shown.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
              {warnings.hidden > 0 ? <li>và {warnings.hidden} cảnh báo khác</li> : null}
            </ul>
          ) : null}
          {shownProblem ? (
            <p role="alert" className="text-[11px] text-red-600">
              {shownProblem}
            </p>
          ) : null}
          {note ? (
            <p role="status" className="text-[11px] text-emerald-700">
              {note}
            </p>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
