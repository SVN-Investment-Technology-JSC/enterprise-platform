export type OverviewTab = 'detail' | 'progress' | 'dependencies' | 'documents';

export const OVERVIEW_TABS: readonly OverviewTab[] = ['detail', 'progress', 'dependencies', 'documents'];

/** Tab đã lưu của đúng công việc này; không phải việc này hoặc giá trị lạ (kể cả tab "links" cũ đã bỏ) thì về tab mặc định. */
export function parseStoredTab(raw: string | null | undefined, itemId: string): OverviewTab {
  const [id, tab] = (raw ?? '').split('|');
  if (id === itemId && OVERVIEW_TABS.includes(tab as OverviewTab)) return tab as OverviewTab;
  return 'detail';
}
