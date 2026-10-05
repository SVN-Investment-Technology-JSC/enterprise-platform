/**
 * Mau lich nghi le tham khao (FIX-C-09). Chi chua cac ngay duong lich co dinh.
 * Tet Nguyen dan va Gio To Hung Vuong KHONG hard-code ngay: moi nam do HR nhap tay
 * theo thong bao hien hanh, hoac bo sung vao `byYear` khi da biet.
 * Tep nay la nguon duy nhat de HR/phap che duy tri; khong sua ma nghiep vu.
 */
export interface HolidayTemplateItem {
  /** MM-DD (duong lich) hoac null khi can nhap tay theo nam. */
  monthDay: string | null;
  name: string;
  paid: boolean;
  note: string;
}
export interface HolidayTemplateYearItem {
  date: string;
  name: string;
  paid: boolean;
  note: string;
}

export const HOLIDAY_TEMPLATE_LABEL =
  'Mẫu tham khảo - cần HR xác nhận theo thông báo hiện hành';

export const HOLIDAY_TEMPLATE_FIXED: HolidayTemplateItem[] = [
  { monthDay: '01-01', name: 'Tết Dương lịch', paid: true, note: 'Bộ luật Lao động, Điều 112' },
  { monthDay: '04-30', name: 'Ngày Giải phóng miền Nam', paid: true, note: 'Bộ luật Lao động, Điều 112' },
  { monthDay: '05-01', name: 'Ngày Quốc tế Lao động', paid: true, note: 'Bộ luật Lao động, Điều 112' },
  { monthDay: '09-02', name: 'Quốc khánh', paid: true, note: 'Bộ luật Lao động, Điều 112' },
  {
    monthDay: '09-01',
    name: 'Quốc khánh (ngày liền kề)',
    paid: true,
    note: 'Ngày liền kề Quốc khánh theo thông báo hàng năm; HR xác nhận hoặc bỏ dòng này',
  },
];

/** Cac muc phai nhap tay ngay moi nam (am lich). */
export const HOLIDAY_TEMPLATE_MANUAL: HolidayTemplateItem[] = [
  { monthDay: null, name: 'Tết Nguyên đán (ngày 1)', paid: true, note: 'Nhập ngày theo thông báo của Nhà nước; thêm các ngày nghỉ Tết còn lại thủ công' },
  { monthDay: null, name: 'Giỗ Tổ Hùng Vương (10/3 âm lịch)', paid: true, note: 'Nhập ngày dương lịch tương ứng theo thông báo' },
];

/** Ngay da biet theo tung nam, do HR bo sung: { 2027: [{ date, name, paid, note }] }. */
export const HOLIDAY_TEMPLATE_BY_YEAR: Record<number, HolidayTemplateYearItem[]> = {};
