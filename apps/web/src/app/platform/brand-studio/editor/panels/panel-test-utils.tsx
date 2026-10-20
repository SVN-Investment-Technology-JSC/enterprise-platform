import {
  DEFAULT_PALETTE,
  DEFAULT_RULES,
  createDocument,
  createEditorState,
  createShape,
  editorReducer,
  type BrandPalette,
  type BrandRules,
  type EditorAction,
  type EditorState,
  type Geometry,
  type IconDocument,
  type IconShape,
} from '@enterprise-platform/shared-brand-icon';
import { render, type RenderResult } from '@testing-library/react';
import { useCallback, useReducer, type ReactElement } from 'react';
import type { EditorPanelProps } from './types';

/** Chỉ dùng trong test: dựng một lớp hình với mã cố định để dễ tra cứu. */
export function makeShape(id: string, geometry: Geometry, overrides: Partial<Omit<IconShape, 'geometry'>> = {}): IconShape {
  return createShape(geometry, { id, name: id, ...overrides });
}

export const rectShape = (id: string, x = 6, y = 6, width = 12, height = 12, overrides: Partial<Omit<IconShape, 'geometry'>> = {}) =>
  makeShape(id, { type: 'rect', x, y, width, height, rx: 0 }, overrides);

export const testDoc = (shapes: readonly IconShape[], overrides: Partial<IconDocument> = {}): IconDocument =>
  createDocument({ id: 'test-icon', name: 'Icon thử', shapes, ...overrides });

export interface EditorHarness {
  readonly state: () => EditorState;
  /** Mọi action đã dispatch, theo thứ tự. */
  readonly actions: EditorAction[];
  readonly shape: (id: string) => IconShape;
}

/**
 * Dựng một bảng với editorReducer thật để test thấy đúng hiệu ứng lên tài liệu, lịch sử hoàn tác và vùng chọn.
 */
export function renderWithEditor(
  doc: IconDocument,
  panel: (props: EditorPanelProps) => ReactElement,
  options: { selection?: readonly string[]; palette?: BrandPalette; rules?: BrandRules } = {},
): RenderResult & { harness: EditorHarness } {
  let latest: EditorState = createEditorState(doc);
  const actions: EditorAction[] = [];
  const { selection = [], palette = DEFAULT_PALETTE, rules = DEFAULT_RULES } = options;

  function Harness() {
    const [state, rawDispatch] = useReducer(editorReducer, doc, (initial) => {
      const base = createEditorState(initial);
      return selection.length > 0 ? editorReducer(base, { type: 'select', ids: selection }) : base;
    });
    const dispatch = useCallback(
      (action: EditorAction) => {
        actions.push(action);
        rawDispatch(action);
      },
      [rawDispatch],
    );
    latest = state;
    return panel({ state, dispatch, palette, rules });
  }

  const view = render(<Harness />);
  const harness: EditorHarness = {
    state: () => latest,
    actions,
    shape: (id) => {
      const found = latest.doc.shapes.find((shape) => shape.id === id);
      if (!found) throw new Error(`Không có lớp ${id}`);
      return found;
    },
  };
  return { ...view, harness };
}
