import type { ComponentProps } from "react";
import { Table } from "@dya/ui/components/table";

const TIME_COLUMN_WIDTH = 176;

// Keep timestamps stationary across tabs; spare panel width belongs to the last column.
export function ActivityTable({ columnWidths, timeColumn = 0, style, ...props }: Omit<ComponentProps<typeof Table>, "columnWidths"> & {
  columnWidths: readonly number[];
  timeColumn?: number;
}) {
  const widths = columnWidths.map((width, index) => index === timeColumn ? TIME_COLUMN_WIDTH : width);
  return <Table {...props} columnWidths={widths.map((width, index) => index === widths.length - 1 && index !== timeColumn ? "auto" : width)} style={{ ...style, minWidth: widths.reduce((sum, width) => sum + width, 0) }} />;
}
