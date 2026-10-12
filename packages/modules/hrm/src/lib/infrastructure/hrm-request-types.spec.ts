import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import {
  ENGINE_REQUEST_KIND,
  REQUEST_ENGINES,
  SYSTEM_REQUEST_TYPES,
  isSystemRequestTypeCode,
  mapRequestType,
  requireTypeCode,
  validateRequestTypeFields,
} from './hrm-request-types';

describe('loại đơn hệ thống', () => {
  it('có đúng 7 loại, mã và engine không trùng, mỗi engine hệ thống đúng một loại', () => {
    expect(SYSTEM_REQUEST_TYPES).toHaveLength(7);
    expect(new Set(SYSTEM_REQUEST_TYPES.map((t) => t.code)).size).toBe(7);
    expect(new Set(SYSTEM_REQUEST_TYPES.map((t) => t.engine)).size).toBe(7);
    expect(SYSTEM_REQUEST_TYPES.map((t) => t.engine).sort()).toEqual(
      REQUEST_ENGINES.filter((e) => e !== 'GENERIC').sort(),
    );
  });

  it('mã của loại hệ thống trùng mã engine; kind của engine đúng với các bảng đơn hiện có', () => {
    for (const type of SYSTEM_REQUEST_TYPES) expect(type.code).toBe(type.engine);
    expect(ENGINE_REQUEST_KIND).toEqual({
      LEAVE: 'leave',
      OVERTIME: 'ot',
      BUSINESS_TRIP: 'business_trip',
      SHIFT_CHANGE: 'shift_change',
      ATTENDANCE_CORRECTION: 'correction',
      ADVANCE: 'advance',
      PROFILE_CORRECTION: 'profile_correction',
      GENERIC: 'custom',
    });
  });

  it('mã loại hệ thống không dùng được cho loại tự tạo, không phân biệt hoa thường', () => {
    expect(isSystemRequestTypeCode('leave')).toBe(true);
    expect(isSystemRequestTypeCode('Overtime')).toBe(true);
    expect(isSystemRequestTypeCode('XIN_XAC_NHAN')).toBe(false);
    expect(() => requireTypeCode('leave')).toThrow(BadRequestException);
  });

  it('khớp phần seed 7 loại trong migration 0047 (mã, tên, engine, cách nhập thời gian, thứ tự)', () => {
    const sql = readFileSync(
      resolve(process.cwd(), '../../../migrations/tenant/hrm/0047-hrm-request-types.sql'),
      'utf8',
    );
    const rows = [
      ...sql.matchAll(
        /\('([A-Z_]+)',\s+'([^']+)',\s+'([^']+)',\s+'([A-Z_]+)',\s+'([A-Z_]+)',\s+(\d+)\)/g,
      ),
    ];
    expect(rows).toHaveLength(SYSTEM_REQUEST_TYPES.length);
    for (const [, code, name, description, engine, timeMode, sort] of rows) {
      const type = SYSTEM_REQUEST_TYPES.find((t) => t.code === code);
      expect(type).toBeDefined();
      expect({ name, description, engine, timeMode, sortOrder: Number(sort) }).toEqual({
        name: type!.name,
        description: type!.description,
        engine: type!.engine,
        timeMode: type!.timeMode,
        sortOrder: type!.sortOrder,
      });
    }
  });
});

describe('requireTypeCode', () => {
  it('chuẩn hoá chữ hoa và kiểm tra định dạng', () => {
    expect(requireTypeCode(' xin_xac_nhan ')).toBe('XIN_XAC_NHAN');
    for (const bad of ['', 'a', '1ABC', 'có dấu', 'A-B', 'x'.repeat(51), undefined, 5])
      expect(() => requireTypeCode(bad)).toThrow(BadRequestException);
  });
});

describe('validateRequestTypeFields', () => {
  it('nhận danh sách hợp lệ và chuẩn hoá (cắt khoảng trắng, required mặc định false)', () => {
    const result = validateRequestTypeFields([
      { key: 'noi_nhan', label: ' Nơi nhận ', type: 'text' },
      { key: 'muc_do', label: 'Mức độ', type: 'select', options: [' Gấp ', 'Thường'], required: true },
      { key: 'ngay_hen', label: 'Ngày hẹn', type: 'datetime' },
    ]);
    expect(result).toEqual([
      { key: 'noi_nhan', label: 'Nơi nhận', type: 'text', required: false },
      { key: 'muc_do', label: 'Mức độ', type: 'select', required: true, options: ['Gấp', 'Thường'] },
      { key: 'ngay_hen', label: 'Ngày hẹn', type: 'datetime', required: false },
    ]);
  });

  it('từ chối dữ liệu sai bằng 400 tiếng Việt', () => {
    const bad = (value: unknown) => expect(() => validateRequestTypeFields(value)).toThrow(BadRequestException);
    bad('không phải mảng');
    bad([null]);
    bad([{ key: 'A', label: 'Hoa', type: 'text' }]);
    bad([{ key: '1a', label: 'Số đầu', type: 'text' }]);
    bad([{ key: 'a', label: '', type: 'text' }]);
    bad([{ key: 'a', label: 'x'.repeat(101), type: 'text' }]);
    bad([{ key: 'a', label: 'A', type: 'file' }]);
    bad([{ key: 'a', label: 'A', type: 'text', required: 'yes' }]);
    bad([{ key: 'a', label: 'A', type: 'select' }]);
    bad([{ key: 'a', label: 'A', type: 'select', options: [] }]);
    bad([{ key: 'a', label: 'A', type: 'select', options: ['x', 'x'] }]);
    bad([
      { key: 'a', label: 'A', type: 'text' },
      { key: 'a', label: 'B', type: 'number' },
    ]);
    bad(Array.from({ length: 31 }, (_, i) => ({ key: `f${i}`, label: `F${i}`, type: 'text' })));
  });

  it('danh sách rỗng là hợp lệ (loại đơn không có trường động)', () => {
    expect(validateRequestTypeFields([])).toEqual([]);
  });
});

describe('mapRequestType', () => {
  const row = {
    id: 'id1',
    tenant_id: 't1',
    code: 'XIN_XAC_NHAN',
    name: 'Xin xác nhận',
    description: null,
    engine: 'GENERIC',
    time_mode: 'RANGE_DATETIME',
    requires_attachment: true,
    fields: [{ key: 'a', label: 'A', type: 'text' }],
    icon: null,
    is_system: false,
    active: true,
    sort_order: 80,
    created_at: new Date('2026-10-01T00:00:00Z'),
    updated_at: new Date('2026-10-02T00:00:00Z'),
  };

  it('ánh xạ cột sang hợp đồng, kind suy ra từ engine, usageCount chỉ có khi truy vấn trả về', () => {
    expect(mapRequestType(row)).toMatchObject({
      code: 'XIN_XAC_NHAN',
      engine: 'GENERIC',
      kind: 'custom',
      timeMode: 'RANGE_DATETIME',
      requiresAttachment: true,
      isSystem: false,
      sortOrder: 80,
      usageCount: undefined,
      updatedAt: '2026-10-02T00:00:00.000Z',
    });
    expect(mapRequestType({ ...row, usage_count: '4' }).usageCount).toBe(4);
    expect(mapRequestType({ ...row, engine: 'OVERTIME', fields: null })).toMatchObject({
      kind: 'ot',
      fields: [],
    });
  });
});
