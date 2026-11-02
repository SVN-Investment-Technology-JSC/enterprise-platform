import { evaluateCareSuggestion } from './care-suggestion.js';

describe('evaluateCareSuggestion', () => {
  it('bật cho luồng thường khi chuyển sang Thua', () => {
    expect(evaluateCareSuggestion({ profile: 'STANDARD', careSuggestion: true }, 'LOST')).toEqual({ enabled: true });
  });

  it('tắt khi cờ của luồng tắt', () => {
    expect(evaluateCareSuggestion({ profile: 'STANDARD', careSuggestion: false }, 'LOST')).toEqual({ enabled: false });
  });

  it('luồng TENDER không bao giờ gợi ý, kể cả cờ bật', () => {
    expect(evaluateCareSuggestion({ profile: 'TENDER', careSuggestion: true }, 'LOST')).toEqual({ enabled: false });
  });

  it('không trả gì khi giai đoạn đích không phải Thua', () => {
    expect(evaluateCareSuggestion({ profile: 'STANDARD', careSuggestion: true }, 'OPEN')).toBeUndefined();
    expect(evaluateCareSuggestion({ profile: 'STANDARD', careSuggestion: true }, 'WON')).toBeUndefined();
  });
});
