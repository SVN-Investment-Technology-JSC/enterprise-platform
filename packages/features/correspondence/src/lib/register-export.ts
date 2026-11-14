import type { LetterDirection, LetterSummary } from '@enterprise-platform/contracts-correspondence';
import { formatDay } from './correspondence.model';

/**
 * Sổ đăng ký văn bản đến / đi theo mẫu của Nghị định 30/2020/NĐ-CP (Phụ lục IV), dựng từ danh
 * sách công văn đang lọc. Cột ký nhận để trống cho bản in.
 */
export function registerRows(direction: LetterDirection, letters: readonly LetterSummary[]): (string | number)[][] {
  const note = (letter: LetterSummary) =>
    letter.stage === 'cancelled' ? 'Đã huỷ' : letter.stage === 'archived' ? (letter.archiveCode ? `Hồ sơ ${letter.archiveCode}` : '') : letter.stageLabel;
  if (direction === 'incoming') {
    const ordered = [...letters].sort((left, right) => left.receivedOn.localeCompare(right.receivedOn) || left.incomingNo.localeCompare(right.incomingNo, 'vi', { numeric: true }));
    return [
      ['Ngày đến', 'Số đến', 'Tác giả', 'Số, ký hiệu', 'Ngày tháng', 'Tên loại và trích yếu nội dung', 'Đơn vị hoặc người nhận', 'Ký nhận', 'Ghi chú'],
      ...ordered.map((letter) => [
        formatDay(letter.receivedOn),
        letter.incomingNo,
        letter.senderOrg,
        letter.senderRef ?? '',
        formatDay(letter.senderDate),
        `${letter.kindName} – ${letter.subject}`,
        letter.unitNames.join('; '),
        '',
        note(letter),
      ]),
    ];
  }
  // Sổ văn bản đi chỉ ghi công văn đã ban hành (đã có số đi).
  const issued = [...letters]
    .filter((letter) => Boolean(letter.outgoingNo))
    .sort((left, right) => (left.publishedOn ?? '').localeCompare(right.publishedOn ?? '') || (left.outgoingNo ?? '').localeCompare(right.outgoingNo ?? '', 'vi', { numeric: true }));
  return [
    ['Số, ký hiệu văn bản', 'Ngày tháng văn bản', 'Tên loại và trích yếu nội dung', 'Người ký', 'Nơi nhận văn bản', 'Đơn vị, người nhận bản lưu', 'Số lượng bản', 'Ngày chuyển', 'Ký nhận', 'Ghi chú'],
    ...issued.map((letter) => [
      letter.outgoingNo ?? '',
      formatDay(letter.publishedOn),
      `${letter.kindName} – ${letter.subject}`,
      '',
      letter.recipient ?? '',
      letter.authorUnitName ?? '',
      '',
      formatDay(letter.publishedOn),
      '',
      note(letter),
    ]),
  ];
}

/** Tải sổ đăng ký thành tệp Excel. Trả về số dòng đã ghi. */
export async function downloadRegister(direction: LetterDirection, letters: readonly LetterSummary[], today: string): Promise<number> {
  const rows = registerRows(direction, letters);
  const XLSX = await import('xlsx');
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = rows[0].map((_, index) => ({ wch: index === (direction === 'incoming' ? 5 : 2) ? 60 : 18 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, direction === 'incoming' ? 'Văn bản đến' : 'Văn bản đi');
  XLSX.writeFile(book, `so-dang-ky-van-ban-${direction === 'incoming' ? 'den' : 'di'}-${today}.xlsx`);
  return rows.length - 1;
}
