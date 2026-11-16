/**
 * Chính sách mật khẩu dùng chung cho mọi chỗ đặt mật khẩu (ISS-BE-052): tạo người dùng, quản trị đặt lại, người dùng
 * tự đổi, tạo tenant, đặt lại qua liên kết, nhập dữ liệu. Server luôn kiểm bằng hàm này; giao diện dùng cùng hàm để
 * báo lỗi sớm và hiện dòng gợi ý `PASSWORD_POLICY_HINT`.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_POLICY_HINT =
  `Mật khẩu từ ${PASSWORD_MIN_LENGTH} ký tự, có cả chữ và số, không dùng mật khẩu phổ biến dễ đoán.`;

/**
 * Danh sách nhỏ các mật khẩu phổ biến đã đạt điều kiện độ dài, chữ và số nhưng vẫn dễ đoán. So khớp không phân biệt
 * hoa thường. Không nhằm thay thế kiểm tra rò rỉ đầy đủ.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword1', 'p@ssword123',
  'abc12345', 'abc123456', 'abcd1234', 'abcd12345', 'abc@1234', 'abc@12345', 'a1234567', 'a12345678', 'a123456789',
  '1234567a', '12345678a', '123456789a', '1234abcd', '123abc456', 'aa123456', 'aa12345678',
  'qwerty12', 'qwerty123', 'qwerty1234', 'qwe12345', 'qwe123456', '1qaz2wsx', 'zaq12wsx', '1q2w3e4r', '1q2w3e4r5t',
  'q1w2e3r4', 'q1w2e3r4t5', 'iloveyou1', 'iloveyou2', 'welcome1', 'welcome123', 'letmein1', 'letmein123',
  'admin123', 'admin1234', 'admin12345', 'admin@123', 'administrator1', 'changeme1', 'changeme123',
  'test1234', 'test12345', 'user1234', 'demo1234', 'guest123', 'master123', 'login123', 'hello123', 'sunshine1',
  'matkhau1', 'matkhau123', 'matkhau@123', 'anhyeuem1', 'anhyeuem123', 'vietnam1', 'vietnam123', 'saigon123',
  'hanoi123', 'football1', 'baseball1', 'monkey123', 'dragon123', 'princess1', 'trustno1',
]);

/** Trả câu tiếng Việt nêu lý do nếu mật khẩu không đạt; đạt thì trả `undefined`. */
export function passwordPolicyViolation(password: unknown): string | undefined {
  if (typeof password !== 'string' || !password) return 'Vui lòng nhập mật khẩu.';
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Mật khẩu phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự.`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Mật khẩu không được dài quá ${PASSWORD_MAX_LENGTH} ký tự.`;
  if (!/\p{L}/u.test(password)) return 'Mật khẩu phải có ít nhất một chữ cái.';
  if (!/\d/.test(password)) return 'Mật khẩu phải có ít nhất một chữ số.';
  if (COMMON_PASSWORDS.has(password.toLowerCase()))
    return 'Mật khẩu quá phổ biến, dễ bị đoán. Vui lòng chọn mật khẩu khác.';
  return undefined;
}
