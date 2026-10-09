import type { BatchResult } from "./batchRuntime";
export type ResultFilter = "all" | "failed" | "skipped";
export function filterBatchResults(results: BatchResult[], filter: ResultFilter): BatchResult[] {
  return results.filter(result => filter === "all" || result.status === filter);
}
export function createBatchResults() {
  let results: BatchResult[] = [];
  return {
    get: () => results,
    replace(value: BatchResult[]) { results = value; },
    clear() { results = []; }
  };
}
