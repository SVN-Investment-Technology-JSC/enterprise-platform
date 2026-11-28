import type { useBrandSlot } from '@enterprise-platform/shared-ui';

export type ModuleSlotId = Parameters<typeof useBrandSlot>[0];

/**
 * Ô icon thương hiệu của từng phân hệ (công ty tự cấu hình ở trang Thương hiệu). Phân hệ chưa có ô thì hiện mã ngắn
 * lấy từ danh mục (`icon`, vd "WS", "FIN").
 */
export const MODULE_SLOT_MAP: Partial<Record<string, ModuleSlotId>> = {
  workspace: 'module.workspace',
  hrm: 'module.hrm',
  inventory: 'module.inventory',
  maintenance: 'module.maintenance',
  finance: 'module.finance',
  'procedure-engine': 'module.procedure',
  procedure: 'module.procedure',
  crm: 'module.crm',
  shared: 'module.shared',
  social: 'module.social',
  assistant: 'module.assistant',
  chat: 'module.chat',
  correspondence: 'module.correspondence',
};
