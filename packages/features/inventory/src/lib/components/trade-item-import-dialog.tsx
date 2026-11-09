'use client';

import type {
  ImportConflictPolicy,
  ImportFailure,
  ImportMaterialRow,
  InventoryTradeCatalog,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, CloseGuard } from '@enterprise-platform/shared-ui';
import { useMemo, useState } from 'react';
import {
  buildImportRows,
  catalogAdditionsFor,
  collectImportValues,
  detectMapping,
  downloadUnimported,
  unimportedLines,
  guessDefaultKind,
  IMPORT_FIELDS,
  readImportSheet,
  type CatalogAdditions,
  type ColumnMapping,
  type ImportFieldKey,
  type ImportSheet,
  type ValueDecision,
} from '../trade-import.model';
import { downloadTradeTemplate, TRADE_GROUP_LABEL, type TradeGroup } from '../trade-items.model';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

type ImportResult = {
  created: number;
  updated: number;
  skipped: readonly { line: number; message: string }[];
  failures: readonly ImportFailure[];
};

const CONFLICT_OPTIONS: { value: ImportConflictPolicy; label: string }[] = [
  { value: 'SKIP', label: 'Bỏ qua, giữ bản đang có' },
  { value: 'UPDATE', label: 'Cập nhật bản đang có bằng dữ liệu trong tệp' },
  { value: 'FAIL', label: 'Báo lỗi, không nhập dòng đó' },
];

const ADD = '__add__';
const BLANK = '__blank__';

const kindOptions = (Object.keys(TRADE_GROUP_LABEL) as TradeGroup[]).map((value) => ({
  value,
  label: TRADE_GROUP_LABEL[value],
}));

function decisionOf(value: string): ValueDecision {
  if (value === BLANK) return { action: 'blank' };
  if (value === ADD || value === '') return { action: 'add' };
  return { action: 'map', to: value };
}

const LIST_CLASS = 'm-0 mt-2 max-h-[160px] overflow-y-auto pl-[1.2rem] text-red-700';

/**
 * Nhập hàng hóa, dịch vụ từ Excel bất kỳ, kể cả tệp xuất từ hệ cũ: chọn tệp, kiểm tra việc ghép cột (tự đoán theo
 * tiêu đề, sửa được), quyết định giá trị lạ và người tạo, xem số dòng hợp lệ rồi mới ghi. Dòng lỗi không chặn dòng khác.
 */
export function TradeItemImportDialog({
  catalog,
  existingCodes,
  onCancel,
  onImport,
}: {
  /** Danh mục phân loại và sử dụng khai trong Cài đặt. */
  catalog?: InventoryTradeCatalog;
  /** Mã đang có trong Kho (cả mã đã ngừng dùng), để báo trước dòng nào trùng. */
  existingCodes?: readonly string[];
  onCancel: () => void;
  /** Nhận các dòng đã chuẩn hóa, mục cần thêm vào Cài đặt và cách xử lý mã trùng; trả về kết quả theo số dòng trong tệp. */
  onImport: (
    rows: ImportMaterialRow[],
    additions: CatalogAdditions,
    onConflict: ImportConflictPolicy,
  ) => Promise<ImportResult>;
}) {
  const [sheet, setSheet] = useState<ImportSheet>();
  const [fileName, setFileName] = useState('');
  const [readError, setReadError] = useState<string>();
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [defaultKind, setDefaultKind] = useState<TradeGroup>('GOODS');
  const [categoryChoice, setCategoryChoice] = useState<Record<string, string>>({});
  const [usageChoice, setUsageChoice] = useState<Record<string, string>>({});
  const [blankAuthors, setBlankAuthors] = useState<ReadonlySet<string>>(new Set());
  const [conflictPolicy, setConflictPolicy] = useState<ImportConflictPolicy>('SKIP');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult>();

  const headerOptions = useMemo(
    () => (sheet?.headers ?? []).map((header) => ({ value: header, label: header })),
    [sheet],
  );

  const options = useMemo(
    () => ({
      mapping,
      defaultKind,
      catalog,
      categoryDecisions: Object.fromEntries(Object.entries(categoryChoice).map(([k, v]) => [k, decisionOf(v)])),
      usageDecisions: Object.fromEntries(Object.entries(usageChoice).map(([k, v]) => [k, decisionOf(v)])),
      blankAuthors,
    }),
    [mapping, defaultKind, catalog, categoryChoice, usageChoice, blankAuthors],
  );

  const built = useMemo(() => (sheet ? buildImportRows(sheet, options) : []), [sheet, options]);
  const values = useMemo(
    () => (sheet ? collectImportValues(sheet, { mapping, defaultKind, catalog }) : undefined),
    [sheet, mapping, defaultKind, catalog],
  );
  const valid = built.filter((row) => row.input);
  const invalid = built.filter((row) => row.error);
  const existing = useMemo(() => new Set((existingCodes ?? []).map((code) => code.toUpperCase())), [existingCodes]);
  const conflicts = valid.filter((row) => row.input && existing.has(row.input.code));
  const missingRequired = IMPORT_FIELDS.filter((field) => field.required && !mapping[field.key]);

  const pick = async (file?: File) => {
    setResult(undefined);
    setReadError(undefined);
    setCategoryChoice({});
    setUsageChoice({});
    setBlankAuthors(new Set());
    if (!file) return;
    setFileName(file.name);
    try {
      const read = await readImportSheet(file);
      if (read.rows.length === 0) throw new Error('empty');
      setSheet(read);
      setMapping(detectMapping(read));
      setDefaultKind(guessDefaultKind(read));
    } catch {
      setSheet(undefined);
      setReadError('Không đọc được tệp hoặc tệp không có dòng dữ liệu. Hãy dùng tệp Excel (.xlsx, .xls, .csv).');
    }
  };

  const setField = (key: ImportFieldKey, header: string | undefined) =>
    setMapping((current) => {
      const next = { ...current };
      if (header) next[key] = header;
      else delete next[key];
      return next;
    });

  const toggleAuthor = (name: string) =>
    setBlankAuthors((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const valueOptions = (declared: readonly string[]) => [
    { value: ADD, label: 'Thêm vào Cài đặt' },
    { value: BLANK, label: 'Bỏ trống' },
    ...declared.map((value) => ({ value, label: `Ghép vào: ${value}` })),
  ];
  const allCategories = [...(catalog?.goodsCategories ?? []), ...(catalog?.serviceCategories ?? [])];

  const retryLines = result && sheet ? unimportedLines(built, result.failures) : [];

  const run = async () => {
    setBusy(true);
    try {
      const rows = valid.map((row) => row.input as ImportMaterialRow);
      setResult(await onImport(rows, catalogAdditionsFor(valid, options), conflictPolicy));
    } finally {
      setBusy(false);
    }
  };

  const valueRow = (
    label: string,
    value: string,
    choice: string,
    declared: readonly string[],
    change: (next: string) => void,
  ) => (
    <div key={label} className="grid grid-cols-[minmax(0,1fr)_220px] items-center gap-2">
      <span className="text-sm [overflow-wrap:anywhere]">{label}</span>
      <SearchableSelect
        options={valueOptions(declared)}
        value={choice || ADD}
        placeholder={value}
        onChange={(next) => change(next || ADD)}
        height={36}
        className="w-full"
      />
    </div>
  );

  const dirtySnapshot = JSON.stringify([fileName, mapping, defaultKind, categoryChoice, usageChoice, [...blankAuthors], conflictPolicy]);
  const [initialSnapshot] = useState(dirtySnapshot);
  // Đã nhập xong (có kết quả) thì không còn gì để mất.
  const isDirty = !result && dirtySnapshot !== initialSnapshot;

  return (
    <Dialog onEscape={isDirty ? undefined : onCancel}>
      <DialogContent className="max-w-[760px]" aria-label="Nhập hàng hóa từ Excel">
        <DialogHeader>
          <DialogTitle>Nhập hàng hóa từ Excel</DialogTitle>
          <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
            <DialogCloseButton />
          </CloseGuard>
        </DialogHeader>

        <DialogBody className="flex max-h-[70vh] flex-col gap-4">
          <p className="m-0 text-sm text-slate-600">
            Chọn tệp Excel bất kỳ, kể cả tệp xuất từ hệ cũ: hệ thống tự đoán cột theo tiêu đề và bạn chỉnh lại được.
            Bắt buộc có Mã, Tên và Đơn vị.{' '}
            <Button type="button" variant="outline" onClick={() => downloadTradeTemplate(catalog)}>
              Tải tệp mẫu
            </Button>
          </p>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            aria-label="Chọn tệp Excel"
            onChange={(event) => void pick(event.target.files?.[0])}
          />
          {readError ? (
            <p role="alert" className="m-0 text-sm text-red-600">
              {readError}
            </p>
          ) : null}

          {sheet && !result ? (
            <>
              <section aria-label="Ghép cột">
                <h3 className="m-0 mb-2 text-[15px]">Ghép cột ({sheet.rows.length} dòng trong tệp)</h3>
                <div className="grid gap-2">
                  {IMPORT_FIELDS.map((field) => (
                    <div key={field.key} className="grid grid-cols-[minmax(0,1fr)_260px] items-center gap-2">
                      <Label className="text-sm font-normal text-slate-900" required={field.required}>
                        {field.label}
                      </Label>
                      <SearchableSelect
                        options={headerOptions}
                        value={mapping[field.key] ?? ''}
                        placeholder="— Không nhập —"
                        onChange={(value) => setField(field.key, value || undefined)}
                        clearable
                        height={36}
                        className="w-full"
                      />
                    </div>
                  ))}
                  {!mapping.kind ? (
                    <div className="grid grid-cols-[minmax(0,1fr)_260px] items-center gap-2">
                      <span className="text-sm">Tệp này là</span>
                      <SearchableSelect
                        options={kindOptions}
                        value={defaultKind}
                        placeholder="Loại mặt hàng"
                        onChange={(value) => setDefaultKind((value || 'GOODS') as TradeGroup)}
                        height={36}
                        className="w-full"
                      />
                    </div>
                  ) : null}
                </div>
                {missingRequired.length > 0 ? (
                  <p role="alert" className="m-0 mt-2 text-sm text-red-600">
                    Chưa ghép cột: {missingRequired.map((field) => field.label).join(', ')}.
                  </p>
                ) : null}
              </section>

              {values && values.categories.length + values.usages.length > 0 ? (
                <section aria-label="Giá trị chưa khai báo">
                  <h3 className="m-0 mb-2 text-[15px]">Giá trị chưa có trong Cài đặt</h3>
                  <div className="grid gap-2">
                    {values.categories.map((value) =>
                      valueRow(`Phân loại: ${value}`, value, categoryChoice[value] ?? '', allCategories, (next) =>
                        setCategoryChoice((current) => ({ ...current, [value]: next })),
                      ),
                    )}
                    {values.usages.map((value) =>
                      valueRow(`Sử dụng: ${value}`, value, usageChoice[value] ?? '', catalog?.usageModes ?? [], (next) =>
                        setUsageChoice((current) => ({ ...current, [value]: next })),
                      ),
                    )}
                  </div>
                </section>
              ) : null}

              {values && values.authors.length > 0 ? (
                <section aria-label="Người tạo">
                  <h3 className="m-0 mb-1 text-[15px]">Người tạo ở hệ cũ</h3>
                  <p className="m-0 mb-2 text-[13px] text-slate-600">
                    Giữ nguyên tên người tạo trong tệp. Đánh dấu những người đã nghỉ việc để để trống, xử lý sau.
                  </p>
                  <div className="grid max-h-[160px] gap-1 overflow-y-auto">
                    {values.authors.map((name) => (
                      <label key={name} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="accent-primary" checked={blankAuthors.has(name)} onChange={() => toggleAuthor(name)} />
                        <span>
                          {name}
                          {blankAuthors.has(name) ? ' (để trống)' : ''}
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              ) : null}

              {conflicts.length > 0 ? (
                <section aria-label="Mã trùng">
                  <h3 className="m-0 mb-1 text-[15px]">Mã đã có trong Kho</h3>
                  <p className="m-0 mb-2 text-[13px] text-slate-600">
                    {conflicts.length} dòng trùng mã với hàng đang có (
                    {conflicts
                      .slice(0, 5)
                      .map((row) => row.input?.code)
                      .join(', ')}
                    {conflicts.length > 5 ? '…' : ''}). Chọn cách xử lý:
                  </p>
                  <SearchableSelect
                    options={CONFLICT_OPTIONS}
                    value={conflictPolicy}
                    placeholder="Khi trùng mã"
                    onChange={(value) => setConflictPolicy((value || 'SKIP') as ImportConflictPolicy)}
                    height={36}
                    className="w-full"
                  />
                  {conflictPolicy === 'UPDATE' ? (
                    <p className="m-0 mt-2 text-[13px] text-slate-600">
                      Chỉ ghi các ô có giá trị trong tệp; ô trống không xoá dữ liệu đang có. Mã đã ngừng dùng được bỏ qua.
                      Người tạo, ngày tạo chỉ điền cho mã chưa có người tạo.
                    </p>
                  ) : null}
                </section>
              ) : null}

              <div className="text-sm text-slate-900" role="status">
                <strong>{valid.length}</strong> dòng hợp lệ, <strong>{invalid.length}</strong> dòng lỗi.
                {invalid.length > 0 ? (
                  <ul className={LIST_CLASS}>
                    {invalid.map((row) => (
                      <li key={row.line}>
                        Dòng {row.line}: {row.error}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </>
          ) : null}

          {result ? (
            <div className="text-sm" role="status">
              Đã tạo <strong>{result.created}</strong> mặt hàng
              {result.updated > 0 ? <>, cập nhật <strong>{result.updated}</strong> mã có sẵn</> : null}
              {result.skipped.length > 0 ? `, bỏ qua ${result.skipped.length} dòng trùng mã` : ''}
              {result.failures.length > 0 ? `, ${result.failures.length} dòng không nhập được:` : '.'}
              {result.failures.length > 0 ? (
                <ul className={LIST_CLASS}>
                  {result.failures.map((failure) => (
                    <li key={failure.line}>
                      Dòng {failure.line}: {failure.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
            <Button type="button" variant="outline" disabled={busy}>
              {result ? 'Đóng' : 'Huỷ'}
            </Button>
          </CloseGuard>
          {result && sheet && retryLines.length > 0 ? (
            <Button
              type="button"
              onClick={() => downloadUnimported(sheet, retryLines, fileName)}
              title="Tệp giữ nguyên cấu trúc cũ, chỉ gồm các dòng chưa nhập được, không gồm dòng trùng mã"
            >
              Tải {retryLines.length} dòng chưa nhập được
            </Button>
          ) : null}
          {!result ? (
            <Button
              type="button"
              disabled={busy || !sheet || missingRequired.length > 0 || valid.length === 0}
              onClick={() => void run()}
              title={fileName}
            >
              {busy ? 'Đang nhập…' : `Nhập ${valid.length} dòng`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
