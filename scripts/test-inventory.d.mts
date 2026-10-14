export interface InventoryFile {
  tests: string[];
  expects: number;
}
export type Inventory = Record<string, InventoryFile>;
export function countExpects(source: string): number;
export function inventoryFromReports(reports: Array<{ testResults: Array<{ name: string; assertionResults: Array<{ fullName?: string; title: string }> }> }>, root?: string): Inventory;
export function compareInventories(
  before: Inventory,
  after: Inventory,
): { missing: string[]; countDrops: string[]; expectDrops: string[]; added: string[]; moved: string[] };
