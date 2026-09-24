import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';
import { cn } from '../utils';

function Input({ className, type, onClick, ...props }: React.ComponentProps<'input'>) {
  const handleClick = (e: React.MouseEvent<HTMLInputElement>) => {
    // Với các input ngày tháng / thời gian, tự động clear giá trị khi click để tiện chọn hoặc nhập mới
    if (type === 'date' || type === 'datetime-local' || type === 'month' || type === 'time') {
      const inputEl = e.currentTarget;
      if (inputEl.value) {
        inputEl.value = '';
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    onClick?.(e);
  };

  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      onClick={handleClick}
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-100 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
