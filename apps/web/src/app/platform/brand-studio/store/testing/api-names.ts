/**
 * Tên các hàm gọi API của `brand-api`. Không import gì để `jest.mock('./brand-api', ...)` dùng được trong factory mà
 * không kéo theo vòng phụ thuộc với máy chủ giả.
 */
export const BRAND_API_FUNCTIONS = [
  'listIcons',
  'getIcon',
  'getIconSpec',
  'createIcon',
  'saveIcon',
  'publishIcon',
  'unpublishIcon',
  'archiveIcon',
  'restoreIcon',
  'purgeIcon',
  'getStandards',
  'saveStandards',
] as const;
