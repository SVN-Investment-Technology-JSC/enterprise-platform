import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  RELATED_OBJECT_MAX_PER_ENTITY,
  type RelatedObjectKind,
} from '@enterprise-platform/contracts-workspace';
import { useState } from 'react';
import { pendingRelatedRow, type PendingRelatedObject } from '../related-objects.model';
import { searchRelatedObjects } from '../workspace-api';
import { RelatedObjectsEditor } from './related-objects-editor';

jest.mock('../workspace-api', () => ({
  searchRelatedObjects: jest.fn(),
}));

const search = searchRelatedObjects as jest.Mock;

const CONTRACT: RelatedObjectKind = {
  key: 'crm.contract',
  moduleKey: 'crm',
  moduleLabel: 'Bán hàng',
  label: 'Hợp đồng bán',
  prefill: true,
};
const QUOTE: RelatedObjectKind = { ...CONTRACT, key: 'crm.quote', label: 'Báo giá' };

/** Giữ danh sách như form thật, để kiểm cả luồng điều khiển từ ngoài. */
function Harness({
  kinds,
  initial = [],
  onChange,
}: {
  kinds: readonly RelatedObjectKind[];
  initial?: PendingRelatedObject[];
  onChange?: (rows: PendingRelatedObject[]) => void;
}) {
  const [rows, setRows] = useState(initial);
  return (
    <RelatedObjectsEditor
      kinds={kinds}
      value={rows}
      ariaPrefix="Đối tượng liên quan"
      onChange={(next) => {
        setRows(next);
        onChange?.(next);
      }}
    />
  );
}

beforeAll(() => {
  // jsdom chưa có `scrollIntoView`; ô chọn gọi nó khi gõ tìm để giữ mục đang chọn trong tầm nhìn.
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  search.mockReset();
  search.mockResolvedValue({
    items: [
      { kind: 'crm.contract', id: 'c1', code: 'HĐ-001', label: 'Công trình A', hint: 'Công ty X', status: 'Hiệu lực' },
      { kind: 'crm.contract', id: 'c2', code: 'HĐ-002', label: 'Công trình B' },
    ],
  });
});

afterEach(() => cleanup());

describe('RelatedObjectsEditor', () => {
  it('không có loại nào thì không hiện gì', () => {
    const { container } = render(<Harness kinds={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('gập sẵn; mở ra thì có ngay một dòng, chọn sẵn loại khi chỉ có một loại', () => {
    const changes = jest.fn();
    render(<Harness kinds={[CONTRACT]} onChange={changes} />);
    const head = screen.getByRole('button', { name: /Đối tượng liên quan/ });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(changes).toHaveBeenLastCalledWith([expect.objectContaining({ kind: 'crm.contract', objectId: '' })]);
  });

  it('hồ sơ đã chọn ở dòng khác hiện mờ, không chọn lại được', async () => {
    const first = pendingRelatedRow({ kind: 'crm.contract', objectId: 'c1', label: 'HĐ-001 — Công trình A' });
    const second = pendingRelatedRow({ kind: 'crm.contract' });
    const changes = jest.fn();
    render(<Harness kinds={[CONTRACT, QUOTE]} initial={[first, second]} onChange={changes} />);
    fireEvent.click(screen.getByRole('button', { name: /Đối tượng liên quan/ }));
    await waitFor(() => expect(search).toHaveBeenCalledWith('crm.contract', ''));

    const record = within(screen.getByRole('group', { name: 'Đối tượng liên quan 2: hồ sơ' })).getByRole('textbox');
    fireEvent.click(record);
    const taken = await screen.findByRole('option', { name: /HĐ-001 — Công trình A/ });
    expect(taken.getAttribute('aria-disabled')).toBe('true');
    expect(taken.textContent).toContain('Đã chọn ở dòng khác');
    fireEvent.click(taken);
    expect(changes).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('option', { name: /HĐ-002 — Công trình B/ }));
    expect(changes).toHaveBeenLastCalledWith([
      first,
      expect.objectContaining({ key: second.key, objectId: 'c2', label: 'HĐ-002 — Công trình B' }),
    ]);
  });

  it('gõ vào ô hồ sơ thì hỏi lại module gốc theo chữ đã gõ', async () => {
    render(<Harness kinds={[CONTRACT]} initial={[pendingRelatedRow({ kind: 'crm.contract' })]} />);
    fireEvent.click(screen.getByRole('button', { name: /Đối tượng liên quan/ }));
    const record = within(screen.getByRole('group', { name: 'Đối tượng liên quan 1: hồ sơ' })).getByRole('textbox');
    // Gõ phím trên trình duyệt phát sự kiện `input`.
    fireEvent.input(record, { target: { value: 'công trình' } });
    await waitFor(() => expect(search).toHaveBeenCalledWith('crm.contract', 'công trình'));
  });

  it('nút X bỏ dòng, nút "+" thêm dòng cùng loại với dòng cuối', () => {
    const quote = pendingRelatedRow({ kind: 'crm.quote', objectId: 'q1', label: 'BG-010' });
    const contract = pendingRelatedRow({ kind: 'crm.contract', objectId: 'c1', label: 'HĐ-001' });
    const changes = jest.fn();
    render(<Harness kinds={[CONTRACT, QUOTE]} initial={[contract, quote]} onChange={changes} />);
    fireEvent.click(screen.getByRole('button', { name: /Đối tượng liên quan/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Thêm dòng đối tượng liên quan' }));
    expect(changes).toHaveBeenLastCalledWith([contract, quote, expect.objectContaining({ kind: 'crm.quote', objectId: '' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Bỏ đối tượng liên quan 1' }));
    expect(changes.mock.lastCall?.[0].map((row: PendingRelatedObject) => row.objectId)).toEqual(['q1', '']);
  });

  it('ô chọn loại là danh sách tên loại phẳng theo thứ tự server, chỉ lọc theo tên loại', () => {
    const RECEIPT: RelatedObjectKind = {
      key: 'finance.receipt',
      moduleKey: 'finance',
      moduleLabel: 'Tài chính',
      label: 'Phiếu thu',
      prefill: false,
    };
    const changes = jest.fn();
    render(<Harness kinds={[QUOTE, RECEIPT, CONTRACT]} initial={[pendingRelatedRow()]} onChange={changes} />);
    fireEvent.click(screen.getByRole('button', { name: /Đối tượng liên quan/ }));
    const kindBox = within(screen.getByRole('group', { name: 'Đối tượng liên quan 1: loại hồ sơ' })).getByRole('textbox');
    fireEvent.click(kindBox);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Báo giá',
      'Phiếu thu',
      'Hợp đồng bán',
    ]);
    expect(screen.queryByText(/Bán hàng|Tài chính/)).toBeNull();

    // Gõ khoá kỹ thuật hay tên phân hệ không khớp gì; gõ tên loại (không dấu) thì khớp.
    fireEvent.input(kindBox, { target: { value: 'crm' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    fireEvent.input(kindBox, { target: { value: 'phieu' } });
    fireEvent.click(screen.getByRole('option', { name: 'Phiếu thu' }));
    expect(changes).toHaveBeenLastCalledWith([expect.objectContaining({ kind: 'finance.receipt' })]);
  });

  it('liên kết đã lưu chỉ xem; không gỡ được thì không có nút X; không được thêm thì không có nút "+"', () => {
    const saved = pendingRelatedRow({
      kind: 'crm.contract',
      objectId: 'c1',
      label: 'HĐ-001',
      kindLabel: 'Hợp đồng bán',
      existingId: 'r1',
      canRemove: false,
    });
    render(
      <RelatedObjectsEditor
        kinds={[CONTRACT]}
        value={[saved]}
        onChange={jest.fn()}
        ariaPrefix="Đối tượng liên quan"
        collapsible={false}
        canAdd={false}
      />,
    );
    expect(screen.getByText('Hợp đồng bán')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Đối tượng liên quan 1: hồ sơ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bỏ đối tượng liên quan 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm dòng đối tượng liên quan' })).toBeNull();
  });

  it('đủ số dòng tối đa thì khoá nút "+"', () => {
    const full = Array.from({ length: RELATED_OBJECT_MAX_PER_ENTITY }, (_, index) =>
      pendingRelatedRow({ kind: 'crm.contract', objectId: `c${index}`, label: `HĐ-${index}` }),
    );
    render(<Harness kinds={[CONTRACT]} initial={full} />);
    fireEvent.click(screen.getByRole('button', { name: /Đối tượng liên quan/ }));
    expect((screen.getByRole('button', { name: 'Thêm dòng đối tượng liên quan' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(`Tối đa ${RELATED_OBJECT_MAX_PER_ENTITY} đối tượng.`)).not.toBeNull();
  });
});
