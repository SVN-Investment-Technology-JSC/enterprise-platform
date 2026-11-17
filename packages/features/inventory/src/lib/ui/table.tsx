import * as React from 'react';
import { cn } from './cn';

/**
 * Bảng HTML thường cùng dáng với bảng HRM (không dùng cho bảng lớn cần cột cố định, ở đó dùng antd Table).
 * `TableWrap` là khung cuộn; đặt `className="max-h-..."` để giới hạn chiều cao, đầu bảng sẽ dính trên cùng.
 */
function TableWrap({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="table-wrap" className={cn('min-h-0 overflow-auto', className)} {...props} />;
}

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return <table data-slot="table" className={cn('w-full border-collapse text-[14px]', className)} {...props} />;
}

function TableHead({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-head"
      className={cn('sticky top-0 z-10 bg-slate-50 text-left text-[13px] font-semibold text-slate-700', className)}
      {...props}
    />
  );
}

function TableBody(props: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr data-slot="table-row" className={cn('border-b border-slate-100 align-middle transition-colors hover:bg-slate-50', className)} {...props} />;
}

function TableHeaderCell({ className, ...props }: React.ComponentProps<'th'>) {
  return <th data-slot="table-header-cell" className={cn('px-3 py-2.5', className)} {...props} />;
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('px-3 py-2.5', className)} {...props} />;
}

/** Dòng báo trống hoặc đang tải, trải hết `colSpan` cột. */
function TableEmpty({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-slate-500">
        {children}
      </td>
    </tr>
  );
}

export { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableRow, TableWrap };
