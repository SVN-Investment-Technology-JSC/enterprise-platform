import type { BrandPalette, BrandRules, EditorAction, EditorState } from '@enterprise-platform/shared-brand-icon';
import type { Dispatch } from 'react';

/** Props chung của các bảng bên phải trình thiết kế. */
export interface EditorPanelProps {
  readonly state: EditorState;
  readonly dispatch: Dispatch<EditorAction>;
  readonly palette: BrandPalette;
  readonly rules: BrandRules;
}
