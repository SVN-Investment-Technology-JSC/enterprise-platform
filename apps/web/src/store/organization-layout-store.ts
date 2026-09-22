import {
  configureStore,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';

export type FlowPosition = { x: number; y: number };
export type FlowPositions = Record<string, FlowPosition>;

export type Tree = {
  id: string;
  code: string;
  name: string;
  description?: string;
  isPrimary: boolean;
  status: string;
  layout?: { version?: number; positions?: FlowPositions };
};

export type NodeType = {
  id: string;
  code: string;
  name: string;
  category: 'unit' | 'position';
  description?: string;
  sortOrder?: number;
  isSystem: boolean;
  isActive: boolean;
};

export type Node = {
  id: string;
  treeId: string;
  parentId?: string;
  nodeTypeId: string;
  code: string;
  name: string;
  description?: string;
  sortOrder?: number;
  status: string;
};

export type Assignment = {
  id: string;
  nodeId: string;
  userId: string;
  isPrimary: boolean;
  startDate?: string;
  endDate?: string;
  note?: string;
  status: string;
};

export type OrganizationSnapshot = {
  trees: Tree[];
  nodeTypes: NodeType[];
  nodes: Node[];
  assignments: Assignment[];
  users: { id: string; fullName: string; email: string }[];
};

type LayoutEntry = {
  positions: FlowPositions;
  dirty: boolean;
  revision: number;
};

type OrganizationLayoutState = {
  layouts: Record<string, LayoutEntry>;
};

const initialLayoutState: OrganizationLayoutState = { layouts: {} };

const organizationLayouts = createSlice({
  name: 'organizationLayouts',
  initialState: initialLayoutState,
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

type OrganizationDataState = {
  snapshot: OrganizationSnapshot | null;
  lastUpdated: number;
};

const initialDataState: OrganizationDataState = {
  snapshot: null,
  lastUpdated: 0,
};

const organizationData = createSlice({
  name: 'organizationData',
  initialState: initialDataState,
  reducers: {
    setSnapshot(state, action: PayloadAction<OrganizationSnapshot>) {
      state.snapshot = action.payload;
      state.lastUpdated = Date.now();
    },
    updateNode(
      state,
      action: PayloadAction<{ id: string; changes: Partial<Node> }>,
    ) {
      if (!state.snapshot) return;
      const index = state.snapshot.nodes.findIndex(
        (n) => n.id === action.payload.id,
      );
      if (index !== -1) {
        state.snapshot.nodes[index] = {
          ...state.snapshot.nodes[index],
          ...action.payload.changes,
        };
        state.lastUpdated = Date.now();
      }
    },
    addNode(state, action: PayloadAction<Node>) {
      if (!state.snapshot) return;
      const existing = state.snapshot.nodes.findIndex(
        (n) => n.id === action.payload.id,
      );
      if (existing !== -1) {
        state.snapshot.nodes[existing] = action.payload;
      } else {
        state.snapshot.nodes.push(action.payload);
      }
      state.lastUpdated = Date.now();
    },
    removeNode(state, action: PayloadAction<string>) {
      if (!state.snapshot) return;
      state.snapshot.nodes = state.snapshot.nodes.filter(
        (n) => n.id !== action.payload,
      );
      state.lastUpdated = Date.now();
    },
    updateTree(
      state,
      action: PayloadAction<{ id: string; changes: Partial<Tree> }>,
    ) {
      if (!state.snapshot) return;
      const index = state.snapshot.trees.findIndex(
        (t) => t.id === action.payload.id,
      );
      if (index !== -1) {
        state.snapshot.trees[index] = {
          ...state.snapshot.trees[index],
          ...action.payload.changes,
        };
        state.lastUpdated = Date.now();
      }
    },
    addTree(state, action: PayloadAction<Tree>) {
      if (!state.snapshot) return;
      const existing = state.snapshot.trees.findIndex(
        (t) => t.id === action.payload.id,
      );
      if (existing !== -1) {
        state.snapshot.trees[existing] = action.payload;
      } else {
        state.snapshot.trees.push(action.payload);
      }
      state.lastUpdated = Date.now();
    },
    removeTree(state, action: PayloadAction<string>) {
      if (!state.snapshot) return;
      state.snapshot.trees = state.snapshot.trees.filter(
        (t) => t.id !== action.payload,
      );
      state.lastUpdated = Date.now();
    },
    updateNodeType(
      state,
      action: PayloadAction<{ id: string; changes: Partial<NodeType> }>,
    ) {
      if (!state.snapshot) return;
      const index = state.snapshot.nodeTypes.findIndex(
        (t) => t.id === action.payload.id,
      );
      if (index !== -1) {
        state.snapshot.nodeTypes[index] = {
          ...state.snapshot.nodeTypes[index],
          ...action.payload.changes,
        };
        state.lastUpdated = Date.now();
      }
    },
    addNodeType(state, action: PayloadAction<NodeType>) {
      if (!state.snapshot) return;
      const existing = state.snapshot.nodeTypes.findIndex(
        (t) => t.id === action.payload.id,
      );
      if (existing !== -1) {
        state.snapshot.nodeTypes[existing] = action.payload;
      } else {
        state.snapshot.nodeTypes.push(action.payload);
      }
      state.lastUpdated = Date.now();
    },
    removeNodeType(state, action: PayloadAction<string>) {
      if (!state.snapshot) return;
      state.snapshot.nodeTypes = state.snapshot.nodeTypes.filter(
        (t) => t.id !== action.payload,
      );
      state.lastUpdated = Date.now();
    },
    updateAssignment(
      state,
      action: PayloadAction<{ id: string; changes: Partial<Assignment> }>,
    ) {
      if (!state.snapshot) return;
      const index = state.snapshot.assignments.findIndex(
        (a) => a.id === action.payload.id,
      );
      if (index !== -1) {
        state.snapshot.assignments[index] = {
          ...state.snapshot.assignments[index],
          ...action.payload.changes,
        };
        state.lastUpdated = Date.now();
      }
    },
    addAssignment(state, action: PayloadAction<Assignment>) {
      if (!state.snapshot) return;
      const existing = state.snapshot.assignments.findIndex(
        (a) => a.id === action.payload.id,
      );
      if (existing !== -1) {
        state.snapshot.assignments[existing] = action.payload;
      } else {
        state.snapshot.assignments.push(action.payload);
      }
      state.lastUpdated = Date.now();
    },
    removeAssignment(state, action: PayloadAction<string>) {
      if (!state.snapshot) return;
      state.snapshot.assignments = state.snapshot.assignments.filter(
        (a) => a.id !== action.payload,
      );
      state.lastUpdated = Date.now();
    },
  },
});

export const { cacheLayout, initializeLayout, markLayoutSaved } =
  organizationLayouts.actions;

export const {
  setSnapshot,
  updateNode,
  addNode,
  removeNode,
  updateTree,
  addTree,
  removeTree,
  updateNodeType,
  addNodeType,
  removeNodeType,
  updateAssignment,
  addAssignment,
  removeAssignment,
} = organizationData.actions;

export function makeStore() {
  return configureStore({
    reducer: {
      organizationLayouts: organizationLayouts.reducer,
      organizationData: organizationData.reducer,
    },
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
