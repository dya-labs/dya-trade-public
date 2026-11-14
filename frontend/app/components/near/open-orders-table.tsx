import type { ComponentProps } from "react";
import { TableHead, TableHeader, TableRow } from "@dya/ui/components/table";
import { ActivityTable } from "./activity-table";

export const ordersSectionClass = "space-y-4 px-4 [&>[data-slot=table-container]]:-mx-4 [&>[data-slot=table-container]]:w-[calc(100%+2rem)] [&_table_tr>:first-child]:pl-4 [&_table_tr>:last-child]:pr-4";

export function OpenOrdersTable({ children, ...props }: Omit<ComponentProps<typeof ActivityTable>, "columnWidths">) {
  return <ActivityTable {...props} className="min-w-[880px]" columnWidths={[160, 128, 72, 192, 144, 160, 160, 64]}>
      <TableHeader><TableRow>
        <TableHead>Time</TableHead><TableHead>Market</TableHead><TableHead>Side</TableHead><TableHead className="text-right">Remaining / Original</TableHead><TableHead className="text-right">Limit price</TableHead><TableHead className="text-right">Order value</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Action</span></TableHead>
      </TableRow></TableHeader>
    {children}
  </ActivityTable>;
}
