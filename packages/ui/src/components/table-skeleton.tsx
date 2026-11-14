"use client";
import { SkeletonCell } from "./skeleton";
import { TableCell, TableRow } from "./table";

export function TableSkeletonRows({ columns, rows = 3, className, cellClassName }: { columns: number; rows?: number; className?: string; cellClassName?: string }) {
  return Array.from({ length: rows }, (_, row) => <TableRow key={row} aria-hidden="true" className={className}>
    {Array.from({ length: columns }, (_, column) => <TableCell key={column} className={cellClassName}><SkeletonCell /></TableCell>)}
  </TableRow>);
}
