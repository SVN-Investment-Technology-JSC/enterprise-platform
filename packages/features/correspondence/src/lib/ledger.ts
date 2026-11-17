import {
  DELIVERY_STATUS_LABELS,
  outgoingSender,
  type LetterDirection,
  type LetterSummary,
} from '@enterprise-platform/contracts-correspondence';
import { formatDay } from './correspondence.model';

/** Một cột của sổ theo dõi: tiêu đề, độ rộng (ký tự, cho Excel), giá trị dạng chữ. */
export interface LedgerColumn {
  readonly id: string;
  readonly header: string;
  readonly width: number;
  /** Căn giữa (ngày, số, số bản). */
  readonly center?: boolean;
  readonly value: (letter: LetterSummary) => string;
}

const content: LedgerColumn = {
  id: 'content',
  header: 'Nội dung',
  width: 56,
  value: (letter) => `${letter.kindName.toUpperCase()}\n${letter.subject}`,
};
const copies: LedgerColumn = { id: 'copies', header: 'Số bản', width: 8, center: true, value: (letter) => (letter.copyCount === undefined ? '' : String(letter.copyCount)) };
const archive: LedgerColumn = { id: 'archive', header: 'Số hồ sơ', width: 14, center: true, value: (letter) => letter.archiveCode ?? '' };
const stage: LedgerColumn = { id: 'stage', header: 'Tình trạng', width: 16, value: (letter) => letter.stageLabel };

/**
 * Sổ theo dõi công văn như bảng văn thư vẫn ghi: công văn đến theo ngày đến, số đến; công văn đi theo
 * ngày ban hành, số đi. Cùng một bộ cột cho bảng trên trang và tệp Excel.
 */
export const LEDGER_COLUMNS: Readonly<Record<LetterDirection, readonly LedgerColumn[]>> = {
  incoming: [
    { id: 'date', header: 'Ngày đến', width: 12, center: true, value: (letter) => formatDay(letter.receivedOn) },
    { id: 'no', header: 'Số đến', width: 10, center: true, value: (letter) => letter.incomingNo },
    { id: 'ref', header: 'Số, ký hiệu', width: 22, value: (letter) => letter.senderRef ?? '' },
    content,
    { id: 'org', header: 'Đơn vị gửi', width: 30, value: (letter) => letter.senderOrg },
    { id: 'docDate', header: 'Ngày văn bản', width: 12, center: true, value: (letter) => formatDay(letter.senderDate) },
    copies,
    { id: 'receiver', header: 'Người nhận', width: 20, value: (letter) => (letter.receiverNames ?? []).join(', ') },
    { id: 'units', header: 'Nơi nhận giải quyết', width: 26, value: (letter) => letter.unitNames.join(', ') },
    { id: 'due', header: 'Hạn xử lý', width: 12, center: true, value: (letter) => formatDay(letter.dueOn) },
    stage,
    archive,
  ],
  outgoing: [
    { id: 'date', header: 'Ngày ban hành', width: 12, center: true, value: (letter) => formatDay(letter.publishedOn) },
    { id: 'no', header: 'Số, ký hiệu', width: 18, value: (letter) => letter.outgoingNo ?? `Dự thảo ${letter.incomingNo}` },
    content,
    { id: 'sender', header: 'Người gửi', width: 28, value: (letter) => outgoingSender(letter) },
    { id: 'signer', header: 'Người ký', width: 24, value: (letter) => [letter.signerName, letter.signerTitle].filter(Boolean).join(', ') },
    { id: 'recipient', header: 'Nơi nhận', width: 30, value: (letter) => letter.recipient ?? '' },
    copies,
    { id: 'delivery', header: 'Tình trạng gửi', width: 16, value: (letter) => (letter.deliveryStatus ? DELIVERY_STATUS_LABELS[letter.deliveryStatus] : '') },
    stage,
    archive,
  ],
};

/** Ngày dùng để lọc theo tháng: ngày đến; công văn đi đã ban hành thì ngày ban hành, chưa thì ngày soạn. */
export function ledgerDate(letter: LetterSummary): string {
  return letter.direction === 'outgoing' ? (letter.publishedOn ?? letter.receivedOn) : letter.receivedOn;
}

/** Tải sổ theo dõi thành tệp Excel, đúng các cột đang xem. Trả về số dòng đã ghi. */
export async function downloadLedger(direction: LetterDirection, year: number, letters: readonly LetterSummary[]): Promise<number> {
  const columns = LEDGER_COLUMNS[direction];
  const rows = [columns.map((column) => column.header), ...letters.map((letter) => columns.map((column) => column.value(letter)))];
  const XLSX = await import('xlsx');
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = columns.map((column) => ({ wch: column.width }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, `${direction === 'incoming' ? 'CV ĐẾN' : 'CV ĐI'} ${year}`);
  XLSX.writeFile(book, `so-theo-doi-cong-van-${direction === 'incoming' ? 'den' : 'di'}-${year}.xlsx`);
  return letters.length;
}
