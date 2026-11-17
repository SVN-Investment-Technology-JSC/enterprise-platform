import * as React from 'react';
import { cn } from './cn';

/** Nhãn của ô nhập; `required` thêm dấu * đỏ. */
function Label({
  className,
  required,
  children,
  ...props
}: React.ComponentProps<'label'> & { required?: boolean }) {
  return (
    <label data-slot="label" className={cn('block text-[13px] font-semibold text-slate-700', className)} {...props}>
      {children}
      {required ? <span className="ml-0.5 text-red-600">*</span> : null}
    </label>
  );
}

export { Label };
