import {
  cacheLayout,
  initializeLayout,
  makeStore,
  markLayoutSaved,
  setSnapshot,
  updateNode,
  addNode,
  removeNode,
} from './organization-layout-store';

describe('organization layout Redux cache', () => {
  it('keeps cached coordinates until saved and does not overwrite the cache on reinitialization', () => {
    const store = makeStore();
    const key = 'tenant:tree';

    store.dispatch(
      initializeLayout({ key, positions: { root: { x: 10, y: 20 } } }),
    );
    store.dispatch(
      cacheLayout({ key, positions: { root: { x: 100, y: 200 } } }),
    );
    store.dispatch(
      initializeLayout({ key, positions: { root: { x: 0, y: 0 } } }),
    );

    expect(store.getState().organizationLayouts.layouts[key]).toEqual({
      positions: { root: { x: 100, y: 200 } },
      dirty: true,
      revision: 1,
    });

    store.dispatch(markLayoutSaved({ key, revision: 1 }));
    expect(store.getState().organizationLayouts.layouts[key]?.dirty).toBe(
      false,
    );
  });

  it('manages organization snapshot data and updates nodes reactively', () => {
    const store = makeStore();
    const initialSnapshot = {
      trees: [{ id: 'tree-1', code: 'T1', name: 'Tree 1', isPrimary: true, status: 'active' }],
      nodeTypes: [{ id: 'type-1', code: 'U1', name: 'Unit 1', category: 'unit' as const, isSystem: false, isActive: true }],
      nodes: [{ id: 'node-1', treeId: 'tree-1', nodeTypeId: 'type-1', code: 'N1', name: 'Ban Giám Đốc', status: 'active' }],
      assignments: [],
      users: [{ id: 'user-1', fullName: 'Nguyen Van A', email: 'a@example.com' }],
    };

    store.dispatch(setSnapshot(initialSnapshot));
    expect(store.getState().organizationData.snapshot?.nodes[0].name).toBe('Ban Giám Đốc');

    // Update node optimistic test
    store.dispatch(updateNode({ id: 'node-1', changes: { name: 'Hội Đồng Quản Trị' } }));
    expect(store.getState().organizationData.snapshot?.nodes[0].name).toBe('Hội Đồng Quản Trị');

    // Add node test
    store.dispatch(addNode({ id: 'node-2', treeId: 'tree-1', nodeTypeId: 'type-1', code: 'N2', name: 'Phòng Kỹ Thuật', status: 'active' }));
    expect(store.getState().organizationData.snapshot?.nodes).toHaveLength(2);

    // Remove node test
    store.dispatch(removeNode('node-1'));
    expect(store.getState().organizationData.snapshot?.nodes).toHaveLength(1);
    expect(store.getState().organizationData.snapshot?.nodes[0].id).toBe('node-2');
  });
});
