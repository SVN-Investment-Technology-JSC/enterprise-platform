export type OverviewTab = 'detail' | 'progress' | 'dependencies' | 'documents' | 'links';

export const OVERVIEW_TABS: readonly OverviewTab[] = ['detail', 'progress', 'dependencies', 'documents', 'links'];

/** Tab đã lưu của đúng công việc này; không phải việc này hoặc giá trị lạ thì về tab mặc định. */
export function parseStoredTab(raw: string | null | undefined, itemId: string): OverviewTab {
  const [id, tab] = (raw ?? '').split('|');
  if (id === itemId && OVERVIEW_TABS.includes(tab as OverviewTab)) return tab as OverviewTab;
  return 'detail';
}

/** Tab "Hồ sơ liên kết" chỉ có khi việc có hồ sơ liên kết; không có thì tab đã lưu quy về "Chi tiết". */
export function resolveOverviewTab(tab: OverviewTab, hasLinks: boolean): OverviewTab {
  return tab === 'links' && !hasLinks ? 'detail' : tab;
}
