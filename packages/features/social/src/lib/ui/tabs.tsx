import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from '../utils';

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-2', className)} {...props} />;
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('inline-flex h-9 w-fit items-center rounded-lg bg-slate-100 p-[3px] text-slate-600', className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex h-[30px] cursor-pointer items-center justify-center rounded-md border border-transparent px-3 text-[13px] font-medium whitespace-nowrap outline-none transition-colors hover:text-slate-900 focus-visible:ring-3 focus-visible:ring-ring/30 data-active:bg-white data-active:text-slate-900 data-active:shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger };
