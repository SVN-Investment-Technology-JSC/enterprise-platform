import type { CareSuggestion, Pipeline, StageSemantic } from '@enterprise-platform/contracts-crm';

/**
 * Gợi ý chăm sóc lại khi cơ hội Thua (P2F-01, quyết định P2-D3: chỉ gợi ý, không tự tạo).
 * Chỉ khi giai đoạn đích mang nghĩa Thua, luồng không phải `TENDER` và cờ của luồng đang bật.
 * Trả `undefined` khi chuyển sang giai đoạn khác Thua (phản hồi không mang trường này).
 */
export function evaluateCareSuggestion(
  pipeline: Pick<Pipeline, 'profile' | 'careSuggestion'>,
  toSemantic: StageSemantic,
): CareSuggestion | undefined {
  if (toSemantic !== 'LOST') return undefined;
  return { enabled: pipeline.profile !== 'TENDER' && pipeline.careSuggestion };
}
