'use client';

import {
  DEFAULT_STROKE_WIDTH,
  roundTo,
  type AlignMode,
  type FillRule,
  type LineCap,
  type LineJoin,
  type Matrix,
  type ReorderMode,
  type ShapeStylePatch,
} from '@enterprise-platform/shared-brand-icon';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  BoxSelect,
  ChevronDown,
  ChevronUp,
  Combine,
  Copy,
  FlipHorizontal2,
  FlipVertical2,
  Frame,
  Link2,
  Lock,
  LockOpen,
  RotateCcw,
  RotateCw,
  Spline,
  Split,
  Trash2,
  TriangleAlert,
  Unlink,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Chip, FieldRow, IconButton, Section, ToggleGroup, type ToggleOption } from '../../components/controls';
import { formatDecimal, NumberField, SliderNumber } from '../../components/number-field';
import { PaintPicker } from '../../components/paint-picker';
import { useGesture } from '../../components/use-gesture';
import { IconSettings } from './icon-settings';
import {
  alignTarget,
  commonValue,
  geometryRect,
  hasVisibleFill,
  hasVisibleStroke,
  flipAboutCenter,
  pathActionState,
  rectRadiusInfo,
  resizeMatrix,
  rotateAboutCenter,
  withRectRadius,
  type BoundsField,
} from './properties-model';
import { CapIcon, FillRuleIcon, JoinIcon } from './property-icons';
import { isAllowedStrokeWidth, nearestAllowedStrokeWidth } from './stroke-width';
import type { EditorPanelProps } from './types';

const CAP_OPTIONS: readonly ToggleOption<LineCap>[] = [
  { value: 'round', label: 'Đầu nét tròn', icon: <CapIcon kind="round" /> },
  { value: 'butt', label: 'Đầu nét phẳng', icon: <CapIcon kind="butt" /> },
  { value: 'square', label: 'Đầu nét vuông', icon: <CapIcon kind="square" /> },
];

const JOIN_OPTIONS: readonly ToggleOption<LineJoin>[] = [
  { value: 'round', label: 'Góc nối tròn', icon: <JoinIcon kind="round" /> },
  { value: 'miter', label: 'Góc nối nhọn', icon: <JoinIcon kind="miter" /> },
  { value: 'bevel', label: 'Góc nối vát', icon: <JoinIcon kind="bevel" /> },
];

const FILL_RULE_OPTIONS: readonly ToggleOption<FillRule>[] = [
  { value: 'nonzero', label: 'Tô kín cả phần chồng nhau', icon: <FillRuleIcon kind="nonzero" /> },
  { value: 'evenodd', label: 'Khoét lỗ ở phần chồng nhau', icon: <FillRuleIcon kind="evenodd" /> },
];

const ALIGN_BUTTONS: ReadonlyArray<{ mode: AlignMode; label: string; icon: ReactNode }> = [
  { mode: 'left', label: 'Căn trái', icon: <AlignStartVertical /> },
  { mode: 'center', label: 'Căn giữa theo chiều ngang', icon: <AlignCenterVertical /> },
  { mode: 'right', label: 'Căn phải', icon: <AlignEndVertical /> },
  { mode: 'top', label: 'Căn trên', icon: <AlignStartHorizontal /> },
  { mode: 'middle', label: 'Căn giữa theo chiều dọc', icon: <AlignCenterHorizontal /> },
  { mode: 'bottom', label: 'Căn dưới', icon: <AlignEndHorizontal /> },
];

const ORDER_BUTTONS: ReadonlyArray<{ mode: ReorderMode; label: string; icon: ReactNode }> = [
  { mode: 'front', label: 'Đưa lên trên cùng', icon: <ArrowUpToLine /> },
  { mode: 'forward', label: 'Đưa lên một lớp', icon: <ChevronUp /> },
  { mode: 'backward', label: 'Đưa xuống một lớp', icon: <ChevronDown /> },
  { mode: 'back', label: 'Đưa xuống dưới cùng', icon: <ArrowDownToLine /> },
];

const ALIGN_TARGETS: readonly ToggleOption<'selection' | 'canvas'>[] = [
  { value: 'selection', label: 'Căn so với vùng chọn', icon: <BoxSelect /> },
  { value: 'canvas', label: 'Căn so với khung vẽ', icon: <Frame /> },
];

/** Bảng thuộc tính: sửa lớp đang chọn, hoặc cài đặt chung của icon khi chưa chọn lớp nào. */
export function PropertiesPanel(props: EditorPanelProps) {
  return props.state.selection.length > 0 ? <ShapeProperties {...props} /> : <IconSettings {...props} />;
}

function ShapeProperties({ state, dispatch, palette, rules }: EditorPanelProps) {
  const { doc, selection } = state;
  const gesture = useGesture(dispatch);
  const [lockAspect, setLockAspect] = useState(true);
  const [alignToCanvas, setAlignToCanvas] = useState(false);

  const shapes = useMemo(() => {
    const wanted = new Set(selection);
    return doc.shapes.filter((shape) => wanted.has(shape.id));
  }, [doc.shapes, selection]);
  const editable = useMemo(() => shapes.filter((shape) => !shape.locked), [shapes]);
  const ids = useMemo(() => editable.map((shape) => shape.id), [editable]);

  const disabled = editable.length === 0;
  const allLocked = shapes.length > 0 && disabled;
  // Khi mọi lớp bị khoá vẫn hiện giá trị hiện tại (chỉ đọc).
  const target = disabled ? shapes : editable;

  const rect = useMemo(() => geometryRect(editable), [editable]);
  const paths = useMemo(() => pathActionState(shapes), [shapes]);
  const radius = useMemo(() => rectRadiusInfo(shapes), [shapes]);

  const stroke = commonValue(target, (shape) => shape.stroke, 'none');
  const fill = commonValue(target, (shape) => shape.fill, 'none');
  const opacity = commonValue(target, (shape) => shape.opacity, 1);
  const stroked = target.filter(hasVisibleStroke);
  const filled = target.filter(hasVisibleFill);
  const width = commonValue(stroked, (shape) => shape.strokeWidth, DEFAULT_STROKE_WIDTH);
  const cap = commonValue(stroked, (shape) => shape.linecap, 'round' as LineCap);
  const join = commonValue(stroked, (shape) => shape.linejoin, 'round' as LineJoin);
  const fillOpacity = commonValue(filled, (shape) => shape.fillOpacity, 1);
  const fillRule = commonValue(filled, (shape) => shape.fillRule, 'nonzero' as FillRule);
  const outsideAllowed = stroked.some((shape) => !isAllowedStrokeWidth(shape.strokeWidth, rules.allowedStrokeWidths));

  const patch = (change: ShapeStylePatch) => {
    if (ids.length > 0) dispatch({ type: 'updateShapes', ids, patch: change });
  };
  const transform = (matrix: Matrix | null) => {
    if (matrix && ids.length > 0) dispatch({ type: 'transform', ids, matrix });
  };
  const applyBounds = (field: BoundsField, value: number) => {
    if (rect) transform(resizeMatrix(rect, field, value, lockAspect));
  };
  const snapStrokeWidths = () => {
    const changed = editable.filter(hasVisibleStroke).flatMap((shape) => {
      const next = nearestAllowedStrokeWidth(shape.strokeWidth, rules.allowedStrokeWidths);
      return next === shape.strokeWidth ? [] : [{ ...shape, strokeWidth: next }];
    });
    if (changed.length > 0) dispatch({ type: 'replaceShapes', shapes: changed });
  };

  const scrub = { onScrubStart: gesture.start, onScrubEnd: gesture.end };
  const alignTo = alignTarget(ids.length, alignToCanvas);
  const alignOptions = ALIGN_TARGETS.map((option) => ({ ...option, disabled: option.value === 'selection' && ids.length < 2 }));

  return (
    <div className="text-xs text-slate-700">
      <Section>
        <div className="flex items-center gap-1">
          <p className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800" title={shapes.length === 1 ? shapes[0].name : undefined}>
            {shapes.length === 1 ? shapes[0].name : `${shapes.length} lớp`}
          </p>
          <IconButton label="Nhân đôi" onClick={() => dispatch({ type: 'duplicate', ids: selection })}>
            <Copy />
          </IconButton>
          <IconButton
            label={allLocked ? 'Mở khoá lớp' : 'Khoá lớp'}
            pressed={allLocked}
            onClick={() => dispatch({ type: 'updateShapes', ids: selection, patch: { locked: !allLocked } })}
          >
            {allLocked ? <Lock /> : <LockOpen />}
          </IconButton>
          <IconButton label="Xoá" danger disabled={disabled} onClick={() => dispatch({ type: 'remove', ids })}>
            <Trash2 />
          </IconButton>
        </div>
        {allLocked ? <p className="text-[11px] text-slate-500">Lớp đang khoá, mở khoá để chỉnh.</p> : null}
      </Section>

      <Section title="Màu">
        <FieldRow label="Nét">
          <PaintPicker
            value={stroke.value}
            mixed={stroke.mixed}
            allowNone
            label="Màu nét"
            palette={palette}
            disabled={disabled}
            onChange={(paint) => patch({ stroke: paint })}
            {...scrub}
          />
        </FieldRow>
        <FieldRow label="Tô">
          <PaintPicker
            value={fill.value}
            mixed={fill.mixed}
            allowNone
            label="Màu tô"
            palette={palette}
            disabled={disabled}
            onChange={(paint) => patch({ fill: paint })}
            {...scrub}
          />
        </FieldRow>
        {filled.length > 0 ? (
          <>
            <FieldRow label="Mờ tô" title="Độ mờ của màu tô">
              <SliderNumber
                label="Độ mờ màu tô"
                value={Math.round(fillOpacity.value * 100)}
                mixed={fillOpacity.mixed}
                min={0}
                max={100}
                step={1}
                digits={0}
                suffix="%"
                disabled={disabled}
                onChange={(value) => patch({ fillOpacity: value / 100 })}
                {...scrub}
              />
            </FieldRow>
            <FieldRow label="Quy tắc" title="Quy tắc tô khi đường tự chồng lên nhau">
              <ToggleGroup
                ariaLabel="Quy tắc tô"
                value={fillRule.mixed ? null : fillRule.value}
                options={FILL_RULE_OPTIONS}
                disabled={disabled}
                onChange={(value) => patch({ fillRule: value })}
              />
            </FieldRow>
          </>
        ) : null}
        <FieldRow label="Mờ" title="Độ mờ của cả lớp">
          <SliderNumber
            label="Độ mờ"
            value={Math.round(opacity.value * 100)}
            mixed={opacity.mixed}
            min={0}
            max={100}
            step={1}
            digits={0}
            suffix="%"
            disabled={disabled}
            onChange={(value) => patch({ opacity: value / 100 })}
            {...scrub}
          />
        </FieldRow>
      </Section>

      {stroked.length > 0 ? (
        <Section title="Nét">
          <FieldRow label="Dày" title="Độ dày nét">
            <SliderNumber
              label="Độ dày nét"
              value={width.value}
              mixed={width.mixed}
              min={0.25}
              max={6}
              step={0.25}
              digits={2}
              disabled={disabled}
              onChange={(value) => patch({ strokeWidth: value })}
              {...scrub}
            />
          </FieldRow>
          {rules.allowedStrokeWidths.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1 pl-12">
              {rules.allowedStrokeWidths.map((allowed) => (
                <Chip
                  key={allowed}
                  label={`Độ dày ${formatDecimal(allowed, 2)}`}
                  pressed={!width.mixed && Math.abs(width.value - allowed) < 0.011}
                  disabled={disabled}
                  onClick={() => patch({ strokeWidth: allowed })}
                >
                  {formatDecimal(allowed, 2)}
                </Chip>
              ))}
            </div>
          ) : null}
          {outsideAllowed ? (
            <div className="flex items-center gap-1.5 pl-12 text-[11px] text-amber-700" role="status">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">Ngoài bộ nét cho phép</span>
              <button
                type="button"
                disabled={disabled}
                onClick={snapStrokeWidths}
                title="Đưa về độ dày gần nhất trong bộ cho phép"
                className="shrink-0 text-blue-700 hover:underline disabled:opacity-40"
              >
                Chuẩn hoá
              </button>
            </div>
          ) : null}
          <FieldRow label="Đầu" title="Đầu nét">
            <ToggleGroup
              ariaLabel="Đầu nét"
              value={cap.mixed ? null : cap.value}
              options={CAP_OPTIONS}
              disabled={disabled}
              onChange={(value) => patch({ linecap: value })}
            />
          </FieldRow>
          <FieldRow label="Góc" title="Góc nối">
            <ToggleGroup
              ariaLabel="Góc nối"
              value={join.mixed ? null : join.value}
              options={JOIN_OPTIONS}
              disabled={disabled}
              onChange={(value) => patch({ linejoin: value })}
            />
          </FieldRow>
        </Section>
      ) : null}

      <Section title="Vị trí">
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField
            label="Vị trí X"
            prefix="X"
            value={rect ? roundTo(rect.x, 2) : null}
            step={rules.snapStep}
            digits={2}
            disabled={disabled || !rect}
            onCommit={(value) => applyBounds('x', value)}
          />
          <NumberField
            label="Vị trí Y"
            prefix="Y"
            value={rect ? roundTo(rect.y, 2) : null}
            step={rules.snapStep}
            digits={2}
            disabled={disabled || !rect}
            onCommit={(value) => applyBounds('y', value)}
          />
          <NumberField
            label="Chiều rộng"
            prefix="Rộng"
            value={rect ? roundTo(rect.width, 2) : null}
            min={0.1}
            step={rules.snapStep}
            digits={2}
            disabled={disabled || !rect}
            onCommit={(value) => applyBounds('width', value)}
          />
          <div className="flex items-center gap-1">
            <NumberField
              label="Chiều cao"
              prefix="Cao"
              value={rect ? roundTo(rect.height, 2) : null}
              min={0.1}
              step={rules.snapStep}
              digits={2}
              disabled={disabled || !rect}
              onCommit={(value) => applyBounds('height', value)}
              className="flex-1"
            />
            <IconButton
              label={lockAspect ? 'Đang khoá tỷ lệ' : 'Khoá tỷ lệ rộng cao'}
              pressed={lockAspect}
              onClick={() => setLockAspect((value) => !value)}
            >
              {lockAspect ? <Link2 /> : <Unlink />}
            </IconButton>
          </div>
        </div>
        {radius.applicable ? (
          <FieldRow label="Bo góc">
            <SliderNumber
              label="Bo góc"
              value={radius.value}
              mixed={radius.mixed}
              min={0}
              max={Math.max(radius.max, 0)}
              step={rules.snapStep}
              digits={2}
              disabled={disabled}
              onChange={(value) => dispatch({ type: 'replaceShapes', shapes: withRectRadius(editable, value) })}
              {...scrub}
            />
          </FieldRow>
        ) : null}
      </Section>

      <Section title="Biến đổi">
        <div className="flex items-center gap-0.5">
          <IconButton label="Xoay trái 90 độ" disabled={disabled || !rect} onClick={() => rect && transform(rotateAboutCenter(rect, -90))}>
            <RotateCcw />
          </IconButton>
          <IconButton label="Xoay phải 90 độ" disabled={disabled || !rect} onClick={() => rect && transform(rotateAboutCenter(rect, 90))}>
            <RotateCw />
          </IconButton>
          <IconButton label="Lật ngang" disabled={disabled || !rect} onClick={() => rect && transform(flipAboutCenter(rect, 'horizontal'))}>
            <FlipHorizontal2 />
          </IconButton>
          <IconButton label="Lật dọc" disabled={disabled || !rect} onClick={() => rect && transform(flipAboutCenter(rect, 'vertical'))}>
            <FlipVertical2 />
          </IconButton>
          <NumberField
            label="Xoay thêm (độ), Enter để áp dụng"
            value={null}
            placeholder="Xoay"
            suffix="°"
            min={-360}
            max={360}
            step={15}
            digits={1}
            disabled={disabled || !rect}
            onCommit={(degrees) => {
              if (rect && degrees !== 0) transform(rotateAboutCenter(rect, degrees));
            }}
            className="ml-auto w-[84px]"
          />
        </div>
      </Section>

      <Section title="Căn chỉnh">
        <div className="flex items-center gap-0.5">
          {ALIGN_BUTTONS.map((button) => (
            <IconButton
              key={button.mode}
              label={button.label}
              disabled={disabled}
              onClick={() => dispatch({ type: 'align', ids, mode: button.mode, to: alignTo })}
            >
              {button.icon}
            </IconButton>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden="true" />
          <IconButton
            label="Chia đều khoảng cách ngang (từ 3 lớp)"
            disabled={ids.length < 3}
            onClick={() => dispatch({ type: 'distribute', ids, axis: 'horizontal' })}
          >
            <AlignHorizontalDistributeCenter />
          </IconButton>
          <IconButton
            label="Chia đều khoảng cách dọc (từ 3 lớp)"
            disabled={ids.length < 3}
            onClick={() => dispatch({ type: 'distribute', ids, axis: 'vertical' })}
          >
            <AlignVerticalDistributeCenter />
          </IconButton>
        </div>
        <ToggleGroup
          ariaLabel="Căn so với"
          value={alignTo}
          options={alignOptions}
          onChange={(value) => setAlignToCanvas(value === 'canvas')}
        />
      </Section>

      <Section title="Lớp và đường">
        <div className="flex items-center gap-0.5">
          {ORDER_BUTTONS.map((button) => (
            <IconButton
              key={button.mode}
              label={button.label}
              disabled={disabled}
              onClick={() => dispatch({ type: 'reorder', ids, mode: button.mode })}
            >
              {button.icon}
            </IconButton>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Chip label="Gộp nhiều đường thành một (phần chồng thành lỗ)" disabled={!paths.combine} onClick={() => dispatch({ type: 'combine', ids })}>
            <Combine className="mr-1 size-3.5" aria-hidden="true" />
            Gộp
          </Chip>
          <Chip label="Tách đường có nhiều phần thành các lớp riêng" disabled={!paths.separate} onClick={() => dispatch({ type: 'separate', ids })}>
            <Split className="mr-1 size-3.5" aria-hidden="true" />
            Tách
          </Chip>
          <Chip label="Chuyển hình thành đường để sửa điểm neo" disabled={!paths.convert} onClick={() => dispatch({ type: 'convertToPath', ids })}>
            <Spline className="mr-1 size-3.5" aria-hidden="true" />
            Thành đường
          </Chip>
        </div>
      </Section>
    </div>
  );
}
