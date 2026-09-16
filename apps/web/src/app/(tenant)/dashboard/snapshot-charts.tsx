'use client';

import { Bar, BarChart, Cell, Label, Pie, PieChart, XAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

type Slice = { label: string; value: number; color: string };

const chartConfig = {
  value: { label: 'Số lượng', color: '#2563eb' },
} satisfies ChartConfig;

export function ProcedureSummaryCharts({
  status,
  stages,
}: {
  status?: Slice[];
  stages?: Slice[];
}) {
  return (
    <div className="grid w-full grid-cols-[7rem_minmax(0,1fr)] items-center gap-3">
      <CompactDonut data={status} empty="Chưa có hồ sơ" />
      <CompactBars data={stages} empty="Chưa có điểm nghẽn" />
    </div>
  );
}

export function MaintenanceSummaryChart({ data }: { data?: Slice[] }) {
  return (
    <div className="w-full">
      <CompactBars data={data} empty="Chưa có sự cố mở" />
    </div>
  );
}

export function InventorySummaryChart({ data }: { data?: Slice[] }) {
  return (
    <div className="w-full">
      <CompactDonut data={data} empty="Chưa có vật tư" wide />
    </div>
  );
}

function CompactDonut({
  data,
  empty,
  wide = false,
}: {
  data?: Slice[];
  empty: string;
  wide?: boolean;
}) {
  const total = data?.reduce((sum, item) => sum + item.value, 0) ?? 0;
  if (!data || total === 0) return <EmptyChart message={empty} />;
  return (
    <div className={wide ? 'grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3' : ''}>
      <ChartContainer config={chartConfig} className="h-28 w-full">
        <PieChart accessibilityLayer>
          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius={34}
            outerRadius={50}
            paddingAngle={3}
            strokeWidth={0}
          >
            {data.map((item) => (
              <Cell key={item.label} fill={item.color} />
            ))}
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !('cx' in viewBox) || !('cy' in viewBox)) return null;
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy ?? 0) + 6}
                      className="fill-slate-950 text-lg font-bold"
                    >
                      {total}
                    </tspan>
                  </text>
                );
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      {wide ? <Legend data={data} /> : null}
    </div>
  );
}

function CompactBars({ data, empty }: { data?: Slice[]; empty: string }) {
  const total = data?.reduce((sum, item) => sum + item.value, 0) ?? 0;
  if (!data || total === 0) return <EmptyChart message={empty} />;
  return (
    <div>
      <ChartContainer config={chartConfig} className="h-16 w-full">
        <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 0 }}>
          <XAxis dataKey="label" hide />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]}>
            {data.map((item) => (
              <Cell key={item.label} fill={item.color} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <Legend data={data} compact />
    </div>
  );
}

function Legend({ data, compact = false }: { data: Slice[]; compact?: boolean }) {
  return (
    <ul
      className={
        compact
          ? 'mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-500'
          : 'space-y-1.5 text-xs text-slate-600'
      }
    >
      {data.map((item) => (
        <li key={item.label} className="flex items-center gap-1">
          <i className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
          <span className="truncate">{item.label}</span>
          <b className="text-slate-800">{item.value}</b>
        </li>
      ))}
    </ul>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="grid h-24 place-items-center rounded bg-slate-50 px-3 text-center text-xs text-slate-500">
      {message}
    </div>
  );
}
