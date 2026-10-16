import type { Material } from '@enterprise-platform/contracts-inventory';

export type MaterialTrackingMode = 'SERIAL' | 'LOT' | 'NONE';

/**
 * Cách định danh của một vật tư: theo sê-ri, theo lô, hoặc chỉ số lượng.
 *
 * Cùng quy ước với form vật tư (material-form.tsx): chọn "Theo lô" thì vật tư
 * lưu với nhóm CONSUMABLE, "Theo sê-ri" thì bật `isSerialized`. Không suy ra
 * từ mã vật tư — mã do người dùng đặt, không mang nghĩa.
 */
export function trackingModeOf(
  material?: Pick<Material, 'isSerialized' | 'category'>,
): MaterialTrackingMode {
  if (!material) return 'NONE';
  if (material.isSerialized) return 'SERIAL';
  return material.category === 'CONSUMABLE' ? 'LOT' : 'NONE';
}
