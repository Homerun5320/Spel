// Reads the "Budgetar" table of docs/ARCHITECTURE.md: the budgets of the test tier live there (one source of truth).
import fs from 'node:fs';

export interface Budget {
  layer: string;
  triangles: number;
  drawCalls: number;
}

const num = (cell: string): number => Number(cell.replace(/[^\d]/g, ''));

export function readBudgets(file = 'docs/ARCHITECTURE.md'): Budget[] {
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf('## Budgetar');
  if (start < 0) throw new Error('no "## Budgetar" section in docs/ARCHITECTURE.md');
  const rows: Budget[] = [];
  for (const line of text.slice(start).split('\n').slice(1)) {
    if (/^## /.test(line)) break;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 5 || !/^[<\d]/.test(cells[2] ?? '') || !/^[<\d]/.test(cells[3] ?? '')) continue;
    rows.push({ layer: cells[1] as string, triangles: num(cells[2] as string), drawCalls: num(cells[3] as string) });
  }
  return rows;
}
