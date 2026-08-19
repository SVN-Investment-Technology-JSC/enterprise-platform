import {
  cacheLayout,
  initializeLayout,
  makeStore,
  markLayoutSaved,
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
});
