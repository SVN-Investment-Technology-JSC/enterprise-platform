import type { WorkItemCompletionPolicy } from '@enterprise-platform/contracts-workspace';
import {
  cloneCompletion,
  completionDraftOf,
  completionInputOf,
  completionPatchOf,
  completionProblem,
  emptyCompletion,
} from './completion-draft';

const saved: WorkItemCompletionPolicy = {
  rule: 'at_least',
  minRequired: 1,
  conditions: [
    { id: 'c1', label: 'Biên bản' },
    { id: 'c2', label: 'Hoá đơn' },
  ],
};

describe('completionInputOf', () => {
  it('không có điều kiện nào có chữ thì không gửi gì', () => {
    expect(completionInputOf(emptyCompletion())).toBeUndefined();
    expect(completionInputOf({ ...emptyCompletion(), conditions: [{ label: '   ' }] })).toBeUndefined();
  });

  it('bỏ dòng trống, cắt khoảng trắng, giữ id điều kiện đã lưu', () => {
    const input = completionInputOf({
      rule: 'all',
      minRequired: '1',
      conditions: [{ id: 'c1', label: ' Biên bản ' }, { label: '' }, { label: 'Hoá đơn' }],
    });
    expect(input).toEqual({
      rule: 'all',
      conditions: [{ id: 'c1', label: 'Biên bản' }, { label: 'Hoá đơn' }],
    });
  });

  it('chỉ at_least mới mang số tối thiểu', () => {
    const conditions = [{ label: 'A' }, { label: 'B' }];
    expect(completionInputOf({ rule: 'at_least', minRequired: '2', conditions })).toMatchObject({
      minRequired: 2,
    });
    expect(completionInputOf({ rule: 'none', minRequired: '2', conditions })).not.toHaveProperty(
      'minRequired',
    );
  });
});

describe('completionProblem', () => {
  it('hợp lệ khi không đặt điều kiện', () => {
    expect(completionProblem(emptyCompletion())).toBeUndefined();
  });

  it('báo điều kiện trùng không phân biệt hoa thường', () => {
    expect(
      completionProblem({ rule: 'all', minRequired: '1', conditions: [{ label: 'A' }, { label: ' a ' }] }),
    ).toMatch(/trùng/);
  });

  it('báo số tối thiểu ngoài khoảng 1..số điều kiện', () => {
    const conditions = [{ label: 'A' }, { label: 'B' }];
    for (const minRequired of ['0', '3', '', 'abc', '1.5']) {
      expect(completionProblem({ rule: 'at_least', minRequired, conditions })).toMatch(/tối thiểu/);
    }
    expect(completionProblem({ rule: 'at_least', minRequired: '2', conditions })).toBeUndefined();
  });

  it('dòng trống không tính vào số điều kiện', () => {
    expect(
      completionProblem({ rule: 'at_least', minRequired: '2', conditions: [{ label: 'A' }, { label: '' }] }),
    ).toMatch(/từ 1 đến 1/);
  });
});

describe('completionPatchOf', () => {
  it('không đổi so với bản đã lưu thì không gửi (undefined)', () => {
    expect(completionPatchOf(completionDraftOf(saved), saved)).toBeUndefined();
    expect(completionPatchOf(emptyCompletion(), undefined)).toBeUndefined();
  });

  it('xoá hết điều kiện thì gửi null', () => {
    expect(completionPatchOf(emptyCompletion(), saved)).toBeNull();
  });

  it('sửa chữ hoặc đổi quy tắc thì gửi bản mới', () => {
    const draft = completionDraftOf(saved);
    draft.rule = 'all';
    expect(completionPatchOf(draft, saved)).toMatchObject({ rule: 'all' });
  });

  it('thêm điều kiện cho việc chưa có thì gửi bản mới', () => {
    expect(
      completionPatchOf({ rule: 'all', minRequired: '1', conditions: [{ label: 'A' }] }, undefined),
    ).toEqual({ rule: 'all', conditions: [{ label: 'A' }] });
  });
});

describe('cloneCompletion', () => {
  it('tạo bản sao độc lập và bỏ id khi chép sang việc mới', () => {
    const original = completionDraftOf(saved);
    const copy = cloneCompletion(original);
    copy.conditions[0].label = 'Đã sửa';
    expect(original.conditions[0].label).toBe('Biên bản');
    expect(copy.conditions.every((condition) => condition.id === undefined)).toBe(true);
  });
});
