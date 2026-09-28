/** Restricted expression evaluator. No JavaScript execution, property access or external functions. */
const SCALE = 1_000_000n;
const LIMIT = 9_000_000_000_000n * SCALE;
function fixed(value: number | string): bigint {
  const text = String(value);
  if (!/^-?\d+(\.\d{1,6})?$/.test(text))
    throw new Error(`Giá trị số không hợp lệ: ${text}`);
  const negative = text.startsWith('-'),
    [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  const result =
    (BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'))) *
    (negative ? -1n : 1n);
  return bounded(result);
}
const bounded = (n: bigint) => {
  if (n > LIMIT || n < -LIMIT)
    throw new Error('Giá trị công thức vượt giới hạn');
  return n;
};
const divide = (a: bigint, b: bigint) => {
  if (!b) throw new Error('Công thức chia cho 0');
  return a / b;
};
const round = (value: bigint, digits: number) => {
  if (!Number.isInteger(digits) || digits < 0 || digits > 6)
    throw new Error('Số chữ số làm tròn từ 0 đến 6');
  const unit = 10n ** BigInt(6 - digits),
    sign = value < 0n ? -1n : 1n,
    abs = value * sign;
  return ((abs + unit / 2n) / unit) * unit * sign;
};
export function evaluateFormula(
  expression: string,
  resolve: (name: string) => number | string,
): number {
  if (typeof expression !== 'string' || expression.length > 2000)
    throw new Error('Công thức quá dài');
  const tokens =
    expression.match(
      /\d+(?:\.\d+)?|[A-Z][A-Z0-9_]*|<=|>=|==|!=|[+\-*/(),<>]/g,
    ) || [];
  if (tokens.join('') !== expression.replace(/\s/g, '') || tokens.length > 500)
    throw new Error('Ký hiệu công thức không hợp lệ');
  let index = 0,
    depth = 0;
  const take = (value: string) =>
    tokens[index] === value ? (index++, true) : false;
  function primary(active: boolean): bigint {
    if (++depth > 50) throw new Error('Công thức lồng quá sâu');
    let result: bigint;
    if (take('-')) result = -primary(active);
    else if (take('+')) result = primary(active);
    else if (take('(')) {
      result = comparison(active);
      if (!take(')')) throw new Error('Thiếu dấu đóng ngoặc');
    } else {
      const token = tokens[index++];
      if (!token) throw new Error('Thiếu giá trị trong công thức');
      if (/^\d/.test(token)) result = fixed(token);
      else if (/^[A-Z]/.test(token)) {
        if (take('(')) {
          const args: bigint[] = [];
          if (!take(')')) {
            do {
              // Parse every branch, but evaluate only the selected IF branch.
              // This supports guards such as IF(DAYS == 0, 0, PAY / DAYS).
              const selected =
                token !== 'IF' ||
                args.length === 0 ||
                (args.length === 1 ? args[0] !== 0n : args[0] === 0n);
              args.push(comparison(active && selected));
            } while (take(','));
            if (!take(')')) throw new Error('Thiếu dấu đóng hàm');
          }
          if (token === 'MIN' && args.length >= 1)
            result = args.reduce((a, b) => (a < b ? a : b));
          else if (token === 'MAX' && args.length >= 1)
            result = args.reduce((a, b) => (a > b ? a : b));
          else if (token === 'ROUND' && args.length === 2)
            result = active
              ? round(args[0], Number(args[1]) / Number(SCALE))
              : 0n;
          else if (token === 'IF' && args.length === 3)
            result = args[0] !== 0n ? args[1] : args[2];
          else throw new Error(`Hàm hoặc số đối số không hợp lệ: ${token}`);
        } else result = active ? fixed(resolve(token)) : 0n;
      } else throw new Error('Giá trị công thức không hợp lệ');
    }
    depth--;
    return active ? bounded(result) : 0n;
  }
  function multiply(active: boolean): bigint {
    let value = primary(active);
    while (tokens[index] === '*' || tokens[index] === '/') {
      const op = tokens[index++],
        right = primary(active);
      value = active
        ? bounded(
            op === '*'
              ? divide(value * right, SCALE)
              : divide(value * SCALE, right),
          )
        : 0n;
    }
    return value;
  }
  function addition(active: boolean): bigint {
    let value = multiply(active);
    while (tokens[index] === '+' || tokens[index] === '-') {
      const op = tokens[index++],
        right = multiply(active);
      value = bounded(op === '+' ? value + right : value - right);
    }
    return value;
  }
  function comparison(active: boolean): bigint {
    let value = addition(active);
    const op = tokens[index];
    if (['<', '>', '<=', '>=', '==', '!='].includes(op)) {
      index++;
      const right = addition(active);
      value = {
        '<': value < right,
        '>': value > right,
        '<=': value <= right,
        '>=': value >= right,
        '==': value === right,
        '!=': value !== right,
      }[op]
        ? SCALE
        : 0n;
    }
    return value;
  }
  const result = comparison(true);
  if (index !== tokens.length)
    throw new Error('Công thức còn dữ liệu không hợp lệ');
  return Number(round(result, 2)) / Number(SCALE);
}
export interface PayrollComponent {
  code: string;
  type: string;
  name: string;
  formula: string;
}
export function evaluatePayroll(
  components: readonly PayrollComponent[],
  inputs: Record<string, number | string>,
) {
  if (!components.length || components.length > 100)
    throw new Error('Cần từ 1 đến 100 thành phần lương');
  const definitions = new Map<string, PayrollComponent>(),
    values = new Map<string, number>(),
    visiting = new Set<string>();
  for (const component of components) {
    if (
      !/^[A-Z][A-Z0-9_]{0,49}$/.test(component.code) ||
      definitions.has(component.code) ||
      Object.hasOwn(inputs, component.code)
    )
      throw new Error(
        `Mã thành phần trùng hoặc không hợp lệ: ${component.code}`,
      );
    definitions.set(component.code, component);
  }
  // Validate the entire dependency graph, including unselected IF branches.
  // Runtime short-circuiting must not hide a typo or a cycle in a policy.
  const checked = new Set<string>(),
    checking = new Set<string>();
  function validateDependencies(code: string) {
    if (checked.has(code)) return;
    if (checking.has(code))
      throw new Error(`Công thức tham chiếu vòng: ${code}`);
    checking.add(code);
    const formula = definitions.get(code)!.formula;
    if (typeof formula !== 'string')
      throw new Error(`Thiếu công thức: ${code}`);
    for (const match of formula.matchAll(/[A-Z][A-Z0-9_]*/g)) {
      const name = match[0];
      if (
        formula
          .slice(match.index! + name.length)
          .trimStart()
          .startsWith('(')
      )
        continue;
      if (Object.hasOwn(inputs, name)) continue;
      if (!definitions.has(name))
        throw new Error(`Biến chưa được cấu hình: ${name}`);
      validateDependencies(name);
    }
    checking.delete(code);
    checked.add(code);
  }
  for (const code of definitions.keys()) validateDependencies(code);
  function resolve(name: string): number | string {
    if (Object.hasOwn(inputs, name)) return inputs[name];
    if (values.has(name)) return values.get(name)!;
    if (visiting.has(name))
      throw new Error(`Công thức tham chiếu vòng: ${name}`);
    const component = definitions.get(name);
    if (!component) throw new Error(`Biến chưa được cấu hình: ${name}`);
    visiting.add(name);
    const value = evaluateFormula(component.formula, resolve);
    visiting.delete(name);
    values.set(name, value);
    return value;
  }
  return components.map((c) => ({ ...c, amount: Number(resolve(c.code)) }));
}
