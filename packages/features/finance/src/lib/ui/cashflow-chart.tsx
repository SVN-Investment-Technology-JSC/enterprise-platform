'use client';

import type { FinanceCashflowPoint } from '@enterprise-platform/contracts-finance';
import { money, periodLabel } from '../finance-format';

const RECEIPT_COLOR = '#059669';
const PAYMENT_COLOR = '#dc2626';

/** Mốc trục tung "đẹp" (1, 2, 5 x 10^n) cho giá trị lớn nhất; luôn dương để biểu đồ rỗng vẫn vẽ được. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return step * base;
}

/** Số tiền ngắn gọn cho nhãn trục: 1,5 tỷ / 250 tr / 12 k. */
export function shortMoney(value: number): string {
  const abs = Math.abs(value);
  const trim = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
  if (abs >= 1e9) return `${trim(value / 1e9)} tỷ`;
  if (abs >= 1e6) return `${trim(value / 1e6)} tr`;
  if (abs >= 1e3) return `${trim(value / 1e3)} k`;
  return String(value);
}

/**
 * Biểu đồ cột đôi thu/chi theo kỳ, vẽ bằng SVG (không thêm thư viện). Mỗi cột có <title> để rê chuột xem số tiền,
 * và cả biểu đồ có mô tả cho trình đọc màn hình; số liệu đầy đủ luôn nằm ở bảng bên dưới trang báo cáo.
 */
export function CashflowChart({ points, height = 220 }: { points: readonly FinanceCashflowPoint[]; height?: number }) {
  if (!points.length) return <p className="py-8 text-center text-sm text-slate-500">Chưa có dữ liệu để vẽ.</p>;
  const width = Math.max(480, points.length * 44 + 70);
  const left = 54;
  const top = 12;
  const bottom = 28;
  const innerH = height - top - bottom;
  const peak = niceMax(Math.max(...points.flatMap((p) => [p.receipts, p.payments])));
  const slot = (width - left - 8) / points.length;
  const barW = Math.min(18, Math.max(4, slot / 2 - 3));
  const y = (value: number) => top + innerH - (value / peak) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * peak);
  const totalReceipts = points.reduce((s, p) => s + p.receipts, 0);
  const totalPayments = points.reduce((s, p) => s + p.payments, 0);
  // Với nhiều kỳ chỉ ghi nhãn một số kỳ để khỏi đè chữ.
  const labelEvery = Math.ceil(points.length / 12);

  return (
    <div>
      <div className="mb-1 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm" style={{ background: RECEIPT_COLOR }} /> Thu</span>
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm" style={{ background: PAYMENT_COLOR }} /> Chi</span>
      </div>
      <div className="overflow-x-auto">
        <svg role="img" aria-label={`Biểu đồ thu chi ${points.length} kỳ: tổng thu ${money(totalReceipts)}, tổng chi ${money(totalPayments)}`} width={width} height={height} className="max-w-none">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={left} x2={width - 4} y1={y(tick)} y2={y(tick)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={left - 6} y={y(tick) + 4} textAnchor="end" fontSize={10} fill="#64748b">{shortMoney(tick)}</text>
            </g>
          ))}
          {points.map((point, index) => {
            const x = left + index * slot + slot / 2;
            return (
              <g key={point.period}>
                <rect x={x - barW - 1} y={y(point.receipts)} width={barW} height={Math.max(0, top + innerH - y(point.receipts))} fill={RECEIPT_COLOR} rx={2}>
                  <title>{`${periodLabel(point.period)}: thu ${money(point.receipts)}`}</title>
                </rect>
                <rect x={x + 1} y={y(point.payments)} width={barW} height={Math.max(0, top + innerH - y(point.payments))} fill={PAYMENT_COLOR} rx={2}>
                  <title>{`${periodLabel(point.period)}: chi ${money(point.payments)}`}</title>
                </rect>
                {index % labelEvery === 0 ? (
                  <text x={x} y={height - 10} textAnchor="middle" fontSize={10} fill="#64748b">{periodLabel(point.period)}</text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
