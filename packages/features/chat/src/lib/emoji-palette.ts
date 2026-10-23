/**
 * Bảng biểu tượng cảm xúc của khung soạn tin. Biểu tượng là NỘI DUNG người dùng gõ vào tin (như gõ từ bàn phím
 * điện thoại), không phải chữ trên giao diện, nên được khai bằng mã điểm Unicode thay vì viết thẳng ký tự: giao diện
 * hệ thống vẫn không có emoji, quy tắc kiểm giao diện vẫn đúng. Chỉ chọn ký tự hiển thị dạng emoji mặc định
 * (không cần ký tự biến thể) để mọi trình duyệt vẽ giống nhau.
 */
export interface EmojiCategory {
  readonly id: string;
  readonly label: string;
  readonly codePoints: readonly number[];
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Mặt cười',
    codePoints: [
      ...range(0x1f600, 0x1f637),
      ...range(0x1f641, 0x1f644),
      0x1f910, 0x1f911, 0x1f912, 0x1f913, 0x1f914, 0x1f915, 0x1f917, 0x1f920, 0x1f922, 0x1f923, 0x1f924, 0x1f925,
      0x1f927, 0x1f928, 0x1f929, 0x1f92a, 0x1f92b, 0x1f92c, 0x1f92d, 0x1f92e, 0x1f92f, 0x1f970, 0x1f971, 0x1f972,
      0x1f973, 0x1f974, 0x1f975, 0x1f976, 0x1f979, 0x1f97a, 0x1f9d0,
    ],
  },
  {
    id: 'gestures',
    label: 'Cử chỉ',
    codePoints: [
      0x1f44d, 0x1f44e, 0x1f44c, 0x1f44f, 0x1f64c, 0x1f64f, 0x1f91d, 0x1f44b, 0x1f44a, 0x1f91c, 0x1f91b, 0x1f4aa,
      0x1f91e, 0x1f91f, 0x1f918, 0x1f919, 0x1f446, 0x1f447, 0x1f448, 0x1f449, 0x1f450, 0x1f932, 0x1f64b, 0x1f646,
      0x1f645, 0x1f647, 0x1f926, 0x1f937, 0x1f440, 0x1f9e0,
    ],
  },
  {
    id: 'symbols',
    label: 'Biểu tượng',
    codePoints: [
      ...range(0x1f493, 0x1f49f),
      0x1f9e1, 0x1f90d, 0x1f90e, 0x1f494, 0x1f525, 0x1f4af, 0x1f4a5, 0x1f4ab, 0x1f31f, 0x1f389, 0x1f38a, 0x1f381,
      0x1f388, 0x1f3c6, 0x1f3c5, 0x1f947, 0x1f680, 0x1f4a1, 0x1f4cc, 0x1f4ce, 0x1f4dd, 0x1f4c5, 0x1f4bc, 0x1f4ca,
      0x1f4c8, 0x1f4c9, 0x1f514, 0x1f4e2, 0x1f4e9, 0x1f4de, 0x1f4bb, 0x1f4f1, 0x1f511, 0x1f512, 0x1f6a8, 0x1f6a7,
    ],
  },
  {
    id: 'food',
    label: 'Ăn uống',
    codePoints: [
      0x1f355, 0x1f354, 0x1f35f, 0x1f35c, 0x1f35a, 0x1f35b, 0x1f363, 0x1f371, 0x1f370, 0x1f382, 0x1f369, 0x1f36a,
      0x1f36d, 0x1f366, 0x1f349, 0x1f34e, 0x1f34a, 0x1f34c, 0x1f347, 0x1f353, 0x1f96d, 0x1f37a, 0x1f37b, 0x1f377,
      0x1f379, 0x1f964, 0x1f9cb, 0x1f95b,
    ],
  },
  {
    id: 'nature',
    label: 'Thiên nhiên',
    codePoints: [
      0x1f331, 0x1f332, 0x1f333, 0x1f334, 0x1f335, 0x1f337, 0x1f338, 0x1f339, 0x1f33a, 0x1f33b, 0x1f33c, 0x1f340,
      0x1f341, 0x1f342, 0x1f31e, 0x1f31d, 0x1f319, 0x1f308, 0x1f30a, 0x1f436, 0x1f431, 0x1f43c, 0x1f428, 0x1f42f,
      0x1f981, 0x1f984, 0x1f98b, 0x1f41d, 0x1f427, 0x1f985,
    ],
  },
];

export function emojiOf(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}

const RECENT_KEY = 'ep-chat-emoji-recent';
const RECENT_LIMIT = 24;

export function recentEmoji(): number[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is number => Number.isInteger(value)).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(codePoint: number): void {
  try {
    const next = [codePoint, ...recentEmoji().filter((value) => value !== codePoint)].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Không lưu được thì thôi.
  }
}
