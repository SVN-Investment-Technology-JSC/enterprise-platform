import {
  configureStore,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';

export type FlowPosition = { x: number; y: number };
export type FlowPositions = Record<string, FlowPosition>;

type LayoutEntry = {
  positions: FlowPositions;
  dirty: boolean;
  revision: number;
};

type OrganizationLayoutState = {
  layouts: Record<string, LayoutEntry>;
};

const initialState: OrganizationLayoutState = { layouts: {} };

const organizationLayouts = createSlice({
  name: 'organizationLayouts',
  initialState,
  reducers: {
    initializeLayout(
      state,
      action: PayloadAction<{ key: string; positions: FlowPositions }>,
    ) {
      if (!state.layouts[action.payload.key]) {
        state.layouts[action.payload.key] = {
          positions: action.payload.positions,
          dirty: false,
          revision: 0,
        };
      }
    },
    cacheLayout(
      state,
      action: PayloadAction<{ key: string; positions: FlowPositions }>,
    ) {
      state.layouts[action.payload.key] = {
        positions: action.payload.positions,
        dirty: true,
        revision: (state.layouts[action.payload.key]?.revision ?? 0) + 1,
      };
    },
    markLayoutSaved(
      state,
      action: PayloadAction<{ key: string; revision: number }>,
    ) {
      const layout = state.layouts[action.payload.key];
      if (layout?.revision === action.payload.revision) layout.dirty = false;
    },
  },
});

export const { cacheLayout, initializeLayout, markLayoutSaved } =
  organizationLayouts.actions;

export function makeStore() {
  return configureStore({
    reducer: { organizationLayouts: organizationLayouts.reducer },
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
