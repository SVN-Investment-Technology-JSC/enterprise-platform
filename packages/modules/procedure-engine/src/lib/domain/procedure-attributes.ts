import {
  PROCEDURE_ATTRIBUTE_TYPES,
  isBlankAttributeValue,
  type ProcedureAttributeDefinition,
  type ProcedureAttributeValue,
} from '@enterprise-platform/contracts-procedure-engine';
import { ProcedureEngineError } from './procedure-engine.error.js';

const ATTRIBUTE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const MAX_ATTRIBUTES = 50;
const MAX_OPTIONS = 200;

/**
 * Kiểm hình dạng một danh sách định nghĩa thuộc tính (của một bước hoặc của quy
 * trình). Chỉ kiểm cái tự nó sai được — không kiểm tham chiếu chéo, việc đó
 * thuộc luật công bố.
 */
export function validateAttributeDefinitions(
  attributes: readonly ProcedureAttributeDefinition[] | undefined,
  scopeLabel: string,
): void {
  if (!attributes?.length) return;
  if (attributes.length > MAX_ATTRIBUTES) {
    throw new ProcedureEngineError(
      'validation',
      `${scopeLabel} có quá nhiều thuộc tính (tối đa ${MAX_ATTRIBUTES}).`,
    );
  }
  const codes = new Set<string>();
  for (const attribute of attributes) {
    const code = attribute.code?.trim() ?? '';
    if (!ATTRIBUTE_CODE_PATTERN.test(code)) {
      throw new ProcedureEngineError(
        'validation',
        `Mã thuộc tính “${attribute.code}” của ${scopeLabel} phải bắt đầu bằng chữ và chỉ gồm chữ, số, gạch dưới (tối đa 60 ký tự).`,
      );
    }
    const normalized = code.toLowerCase();
    if (codes.has(normalized)) {
      throw new ProcedureEngineError(
        'validation',
        `Mã thuộc tính “${code}” bị trùng trong ${scopeLabel}.`,
      );
    }
    codes.add(normalized);
    if (!attribute.name?.trim() || attribute.name.trim().length > 180) {
      throw new ProcedureEngineError(
        'validation',
        `Tên thuộc tính “${code}” của ${scopeLabel} là bắt buộc và không vượt quá 180 ký tự.`,
      );
    }
    if (!PROCEDURE_ATTRIBUTE_TYPES.includes(attribute.type)) {
      throw new ProcedureEngineError(
        'validation',
        `Kiểu dữ liệu của thuộc tính “${code}” không hợp lệ.`,
      );
    }
    if (attribute.type === 'select') {
      const options = attribute.options ?? [];
      if (!options.length || options.length > MAX_OPTIONS) {
        throw new ProcedureEngineError(
          'validation',
          `Thuộc tính danh sách “${code}” phải có từ 1 đến ${MAX_OPTIONS} lựa chọn.`,
        );
      }
      const optionCodes = new Set<string>();
      for (const option of options) {
        if (!option.code?.trim() || !option.label?.trim()) {
          throw new ProcedureEngineError(
            'validation',
            `Lựa chọn của thuộc tính “${code}” phải có mã và nhãn.`,
          );
        }
        if (optionCodes.has(option.code.trim())) {
          throw new ProcedureEngineError(
            'validation',
            `Lựa chọn “${option.code}” của thuộc tính “${code}” bị trùng.`,
          );
        }
        optionCodes.add(option.code.trim());
      }
    }
  }
}

/** Chuẩn hoá định nghĩa trước khi lưu: cắt khoảng trắng, bỏ `options` ở kiểu không dùng. */
export function normalizeAttributeDefinitions(
  attributes: readonly ProcedureAttributeDefinition[] | undefined,
  nextId: () => string,
): ProcedureAttributeDefinition[] | undefined {
  if (!attributes?.length) return undefined;
  return attributes.map((attribute) => ({
    id: attribute.id?.trim() || nextId(),
    code: attribute.code.trim(),
    name: attribute.name.trim(),
    type: attribute.type,
    required: attribute.required === true,
    options:
      attribute.type === 'select'
        ? attribute.options?.map((option) => ({
            code: option.code.trim(),
            label: option.label.trim(),
          }))
        : undefined,
  }));
}

/**
 * Kiểm một giá trị do người dùng gửi lên theo đúng định nghĩa và trả bản đã
 * chuẩn hoá. Không tin kiểu mà client tự khai: kiểu luôn lấy từ định nghĩa.
 */
export function normalizeAttributeValue(
  definition: ProcedureAttributeDefinition,
  input: unknown,
): ProcedureAttributeValue | undefined {
  const raw =
    input && typeof input === 'object' && 'value' in input
      ? (input as { value: unknown }).value
      : input;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const fail = (reason: string): never => {
    throw new ProcedureEngineError(
      'validation',
      `Giá trị của “${definition.name}” không hợp lệ: ${reason}.`,
    );
  };

  switch (definition.type) {
    case 'text': {
      if (typeof raw !== 'string') return fail('cần văn bản');
      const value = raw.trim();
      if (value.length > 4000) return fail('dài quá 4000 ký tự');
      return value ? { type: 'text', value } : undefined;
    }
    case 'number':
    case 'money':
    case 'percent': {
      const value = typeof raw === 'string' ? Number(raw) : raw;
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail('cần một số');
      if (definition.type === 'money') {
        // Tiền là VND số nguyên không âm (chờ chốt Q16).
        if (!Number.isSafeInteger(value) || value < 0) return fail('số tiền phải là số nguyên không âm');
      }
      if (definition.type === 'percent') {
        if (value < 0 || value > 100) return fail('phần trăm phải trong khoảng 0–100');
        return { type: 'percent', value: Math.round(value * 100) / 100 };
      }
      return { type: definition.type, value };
    }
    case 'date': {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
        return fail('ngày phải có dạng YYYY-MM-DD');
      }
      return { type: 'date', value: raw };
    }
    case 'select': {
      if (typeof raw !== 'string') return fail('cần một lựa chọn');
      if (!definition.options?.some((option) => option.code === raw)) {
        return fail('lựa chọn không có trong danh sách');
      }
      return { type: 'select', value: raw };
    }
    case 'boolean': {
      if (typeof raw !== 'boolean') return fail('cần Có hoặc Không');
      return { type: 'boolean', value: raw };
    }
    case 'file': {
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
        return fail('cần danh sách tệp đính kèm');
      }
      const value = [...new Set(raw as string[])];
      return value.length ? { type: 'file', value } : undefined;
    }
    case 'user': {
      if (typeof raw !== 'string' || !raw.trim()) return fail('cần một người dùng');
      const label =
        input && typeof input === 'object' && 'label' in input
          ? String((input as { label: unknown }).label ?? '').trim() || undefined
          : undefined;
      return { type: 'user', value: raw.trim(), label };
    }
  }
}

export function missingRequiredAttributes(
  definitions: readonly ProcedureAttributeDefinition[] | undefined,
  valueOf: (definition: ProcedureAttributeDefinition) => ProcedureAttributeValue | undefined,
): ProcedureAttributeDefinition[] {
  return (definitions ?? []).filter(
    (definition) => definition.required && isBlankAttributeValue(valueOf(definition)),
  );
}
