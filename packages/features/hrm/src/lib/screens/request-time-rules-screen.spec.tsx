import { timeRuleInputError } from './request-time-rules-screen';

describe('timeRuleInputError', () => {
  it('ô rỗng là chưa dùng quy tắc', () => {
    expect(timeRuleInputError('', 0, 365)).toBeNull();
    expect(timeRuleInputError('  ', 1, 90)).toBeNull();
  });
  it('nhận số nguyên trong khoảng, kể cả 0 khi cho phép', () => {
    expect(timeRuleInputError('0', 0, 365)).toBeNull();
    expect(timeRuleInputError('90', 1, 90)).toBeNull();
  });
  it('từ chối 0 khi tối thiểu là 1, số âm, số thập phân, chữ và giá trị vượt khoảng', () => {
    expect(timeRuleInputError('0', 1, 90)).not.toBeNull();
    for (const bad of ['-1', '1.5', 'abc', '366']) expect(timeRuleInputError(bad, 0, 365)).not.toBeNull();
    expect(timeRuleInputError('91', 1, 90)).not.toBeNull();
  });
});
