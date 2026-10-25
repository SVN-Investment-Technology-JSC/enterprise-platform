import { postTopics } from './social.model';

const a = { id: 'a', name: 'A' };
const b = { id: 'b', name: 'B' };

describe('postTopics', () => {
  it('uu tien danh sach day du', () => {
    expect(postTopics({ topic: a, topics: [a, b] })).toEqual([a, b]);
  });

  it('may chu cu chi tra mot chuyen muc thi dung chuyen muc do', () => {
    expect(postTopics({ topic: a })).toEqual([a]);
    expect(postTopics({ topic: a, topics: [] })).toEqual([a]);
  });

  it('khong co chuyen muc', () => {
    expect(postTopics({})).toEqual([]);
  });
});
