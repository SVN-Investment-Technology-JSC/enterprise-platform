import type { CustomFieldDefinition, CustomFieldValue, QuoteCustomFields } from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';

/**
 * Trường tuỳ biến của báo giá (P2I-06): hàm thuần, không DB.
 *
 * Giá trị lưu theo id định nghĩa. Giá trị của trường đã tắt hoặc không còn định nghĩa được giữ nguyên (lịch sử của
 * phiên bản), không kiểm lại. Chỉ giá trị gửi lên mới bị kiểm kiểu và lựa chọn, và chỉ trường đang bật mới nhập được.
 */

const TEXT_MAX = 1000;
const NUMBER_MAX = 1e15;

function fail(code: string, message: string): never {
  throw new CrmValidationError(code, message);
}

/** Kiểm một giá trị theo định nghĩa; trả giá trị đã chuẩn hoá (chuỗi cắt khoảng trắng, số thật). */
export function parseCustomFieldValue(definition: CustomFieldDefinition, raw: unknown): CustomFieldValue {
  const name = `"${definition.name}"`;
  switch (definition.fieldType) {
    case 'SELECT': {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!definition.options.includes(text)) {
        fail('CUSTOM_FIELD_INVALID', `Giá trị của trường ${name} phải là một trong các lựa chọn: ${definition.options.join(', ')}.`);
      }
      return text;
    }
    case 'TEXT': {
      if (typeof raw !== 'string') fail('CUSTOM_FIELD_INVALID', `Trường ${name} phải là văn bản.`);
      const text = raw.trim();
      if (text.length > TEXT_MAX) fail('CUSTOM_FIELD_INVALID', `Trường ${name} tối đa ${TEXT_MAX} ký tự.`);
      return text;
    }
    case 'NUMBER': {
      const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > NUMBER_MAX) {
        fail('CUSTOM_FIELD_INVALID', `Trường ${name} phải là một số hợp lệ.`);
      }
      return value;
    }
    case 'DATE': {
      const text = typeof raw === 'string' ? raw.trim() : '';
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      const valid =
        !!match &&
        (() => {
          const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
          return date.toISOString().slice(0, 10) === text;
        })();
      if (!valid) fail('CUSTOM_FIELD_INVALID', `Trường ${name} phải là ngày dạng năm-tháng-ngày (ví dụ 2026-11-02).`);
      return text;
    }
  }
}

function isEmpty(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
}

/**
 * Giá trị sau khi áp phần sửa `patch` lên giá trị hiện có: mỗi khoá phải là trường đang bật (400 nếu không), giá
 * trị rỗng hoặc `null` là xoá. `enforceRequired`: sau khi áp, mọi trường đang bật và bắt buộc phải có giá trị, thiếu
 * thì 400 nêu tên trường (TC-QF-11).
 */
export function applyCustomFields(
  definitions: readonly CustomFieldDefinition[],
  current: QuoteCustomFields,
  patch: Readonly<Record<string, unknown>> | undefined,
  enforceRequired: boolean,
): QuoteCustomFields {
  if (patch !== undefined && (patch === null || typeof patch !== 'object' || Array.isArray(patch))) {
    fail('CUSTOM_FIELD_INVALID', 'Danh sách trường tuỳ biến không hợp lệ.');
  }
  const active = new Map(definitions.filter((definition) => definition.active).map((definition) => [definition.id, definition]));
  const next: Record<string, CustomFieldValue> = { ...current };
  for (const [id, raw] of Object.entries(patch ?? {})) {
    const definition = active.get(id);
    if (!definition) fail('CUSTOM_FIELD_UNKNOWN', 'Trường tuỳ biến không tồn tại hoặc đã tắt.');
    if (isEmpty(raw)) delete next[id];
    else next[id] = parseCustomFieldValue(definition, raw);
  }
  if (enforceRequired) {
    const missing = [...active.values()]
      .filter((definition) => definition.required && next[definition.id] === undefined)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'));
    if (missing.length) {
      const names = missing.map((definition) => `"${definition.name}"`).join(', ');
      throw new CrmValidationError(
        'CUSTOM_FIELD_REQUIRED',
        missing.length === 1 ? `Vui lòng nhập trường ${names}.` : `Vui lòng nhập các trường bắt buộc: ${names}.`,
        { fields: missing.map((definition) => ({ id: definition.id, name: definition.name })) },
      );
    }
  }
  return next;
}
