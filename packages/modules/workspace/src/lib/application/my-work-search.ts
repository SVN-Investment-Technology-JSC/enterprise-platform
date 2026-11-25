import {
  MY_WORK_SEARCH_FIELDS,
  MY_WORK_SEARCH_MAX_LENGTH,
  type MyWorkItem,
  type MyWorkSearchField,
  type MyWorkStandaloneTask,
} from '@enterprise-platform/contracts-workspace';

/** Tìm kiếm thô từ query string; `parseSearch` tự kiểm giá trị. */
export interface RawMyWorkSearch {
  readonly q?: unknown;
  readonly fields?: unknown;
  readonly personIds?: unknown;
}

/** Điều kiện tìm đã chuẩn hoá. `words` không rỗng; `fields` luôn có ít nhất một phần tử. */
export interface ParsedSearch {
  readonly words: readonly string[];
  readonly fields: ReadonlySet<MyWorkSearchField>;
  readonly personIds: ReadonlySet<string>;
}

const MAX_PERSON_IDS = 200;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hạ chữ thường, bỏ dấu (NFD), `đ` thành `d`, gộp khoảng trắng, cắt hai đầu. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function csvOf(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : [raw];
  return parts
    .filter((part): part is string => typeof part === 'string')
    .flatMap((part) => part.split(','))
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Đọc q/fields/personIds. `q` rỗng hoặc không phải chuỗi thì trả `undefined` (không tìm). Trường lạ bị bỏ;
 * không còn trường hợp lệ nào thì dùng mọi trường. `personIds` chỉ nhận chuỗi giống uuid, tối đa 200.
 */
export function parseSearch(raw: RawMyWorkSearch): ParsedSearch | undefined {
  if (typeof raw.q !== 'string') return undefined;
  // Chặn đầu vào quá dài trước khi chuẩn hoá, rồi cắt theo độ dài tối đa trên chuỗi đã chuẩn hoá.
  const normalized = normalizeSearchText(raw.q.slice(0, MY_WORK_SEARCH_MAX_LENGTH * 10)).slice(
    0,
    MY_WORK_SEARCH_MAX_LENGTH,
  );
  if (!normalized) return undefined;

  const known = new Set<string>(MY_WORK_SEARCH_FIELDS);
  const picked = csvOf(raw.fields).filter((field): field is MyWorkSearchField => known.has(field));
  const personIds = csvOf(raw.personIds)
    .filter((id) => UUID_LIKE.test(id))
    .slice(0, MAX_PERSON_IDS)
    .map((id) => id.toLowerCase());

  return {
    words: normalized.split(' '),
    fields: new Set(picked.length > 0 ? picked : MY_WORK_SEARCH_FIELDS),
    personIds: new Set(personIds),
  };
}

function textMatches(search: ParsedSearch, texts: readonly (string | undefined)[]): boolean {
  const haystack = texts.map((text) => normalizeSearchText(text ?? ''));
  return search.words.every((word) => haystack.some((text) => text.includes(word)));
}

function peopleMatch(search: ParsedSearch, ids: readonly (string | undefined)[]): boolean {
  if (!search.fields.has('people') || search.personIds.size === 0) return false;
  return ids.some((id) => id !== undefined && search.personIds.has(id.toLowerCase()));
}

/** Việc trong dự án khớp khi khớp chữ (mọi từ có trong ít nhất một trường chọn) HOẶC khớp người. */
export function matchesItemSearch(entry: MyWorkItem, search: ParsedSearch): boolean {
  const { item } = entry;
  const texts: (string | undefined)[] = [];
  if (search.fields.has('code')) texts.push(item.code);
  if (search.fields.has('title')) texts.push(item.title);
  if (search.fields.has('description')) texts.push(item.description);
  if (search.fields.has('project')) texts.push(`${entry.projectCode} ${entry.projectName}`);
  return (
    textMatches(search, texts) ||
    peopleMatch(search, [item.createdBy, item.assigneeUserId, ...(item.participantUserIds ?? [])])
  );
}

/** Việc ngoài dự án: như trên nhưng không có trường `project`, và có thêm người theo dõi. */
export function matchesTaskSearch(entry: MyWorkStandaloneTask, search: ParsedSearch): boolean {
  const { task } = entry;
  const texts: (string | undefined)[] = [];
  if (search.fields.has('code')) texts.push(task.code);
  if (search.fields.has('title')) texts.push(task.title);
  if (search.fields.has('description')) texts.push(task.description);
  return (
    textMatches(search, texts) ||
    peopleMatch(search, [
      task.createdBy,
      task.assigneeUserId,
      ...(task.participantUserIds ?? []),
      ...(task.followerUserIds ?? []),
    ])
  );
}
