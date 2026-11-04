import { COMPETITOR_NAME_MAX, parseCompetitorInput, parseNoteInput } from './care-notes.model';

describe('ghi chú chăm sóc (P2F-03, TC-CARE-06 đến TC-CARE-08)', () => {
  it('ghi chú: rỗng là xoá, cắt khoảng trắng, quá dài báo lỗi tiếng Việt', () => {
    expect(parseNoteInput('   ', 10, 'Chân dung')).toEqual({ ok: true, value: null });
    expect(parseNoteInput('  khách mua theo quý ', 100, 'Chân dung')).toEqual({ ok: true, value: 'khách mua theo quý' });
    expect(parseNoteInput('x'.repeat(11), 10, 'Chân dung')).toEqual({ ok: false, message: 'Chân dung tối đa 10 ký tự.' });
  });

  it('đối thủ: rỗng là chưa nhập, giá hợp lệ, giá âm hoặc chữ báo lỗi', () => {
    expect(parseCompetitorInput({ name: '', price: '' })).toEqual({ ok: true, name: null, price: null });
    expect(parseCompetitorInput({ name: ' Công ty A ', price: '1500000' })).toEqual({ ok: true, name: 'Công ty A', price: 1500000 });
    expect(parseCompetitorInput({ name: '', price: '0' })).toEqual({ ok: true, name: null, price: 0 });
    expect(parseCompetitorInput({ name: 'A', price: '-5' })).toEqual({ ok: false, message: 'Giá đối thủ phải là số không âm.' });
    expect(parseCompetitorInput({ name: 'A', price: 'abc' })).toEqual({ ok: false, message: 'Giá đối thủ phải là số không âm.' });
    expect(parseCompetitorInput({ name: 'x'.repeat(COMPETITOR_NAME_MAX + 1), price: '' }).ok).toBe(false);
  });
});
