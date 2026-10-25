import { isMentionComplete, splitMentionTokens } from './social.model';

const picks = [
  { id: 'u1', name: 'Nguyen Van An' },
  { id: 'u2', name: 'An' },
];

describe('splitMentionTokens', () => {
  it('tach doan thuong va ten duoc nhac, ten dai khop truoc', () => {
    expect(splitMentionTokens('chao @Nguyen Van An va @An nhe', picks)).toEqual([
      { text: 'chao ', mention: false },
      { text: '@Nguyen Van An', mention: true },
      { text: ' va ', mention: false },
      { text: '@An', mention: true },
      { text: ' nhe', mention: false },
    ]);
  });

  it('khong co nguoi duoc chon hoac chuoi rong', () => {
    expect(splitMentionTokens('abc', [])).toEqual([{ text: 'abc', mention: false }]);
    expect(splitMentionTokens('', picks)).toEqual([]);
  });

  it('coi ky tu dac biet trong ten la chu thuong', () => {
    expect(splitMentionTokens('hi @A.B (x)', [{ id: 'u3', name: 'A.B (x)' }])).toEqual([
      { text: 'hi ', mention: false },
      { text: '@A.B (x)', mention: true },
    ]);
    expect(splitMentionTokens('hi @AxB (x)', [{ id: 'u3', name: 'A.B (x)' }])).toEqual([{ text: 'hi @AxB (x)', mention: false }]);
  });
});

describe('isMentionComplete', () => {
  it('xong khi la ten day du, hoac ten day du roi dau cach', () => {
    expect(isMentionComplete('Nguyen Van An', picks)).toBe(true);
    expect(isMentionComplete('Nguyen Van An ', picks)).toBe(true);
    expect(isMentionComplete('Nguyen Van An con tiep', picks)).toBe(true);
  });

  it('chua xong khi dang go do hoac la ten khac', () => {
    expect(isMentionComplete('Nguyen Va', picks)).toBe(false);
    expect(isMentionComplete('Anh', picks)).toBe(false);
    expect(isMentionComplete('', picks)).toBe(false);
  });
});
