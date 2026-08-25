import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const taskUpdate = readFileSync(
  resolve(root, "supabase/functions/auvo-task-update/index.ts"),
  "utf8",
);
const searchableSelect = readFileSync(
  resolve(root, "src/components/ui/searchable-select.tsx"),
  "utf8",
);

describe("lista de clientes na abertura de tarefa Auvo", () => {
  it("pagina o cache para não cortar clientes após a linha 1.000", () => {
    expect(taskUpdate).toContain("async function listActiveCustomersFromCache");
    expect(taskUpdate).toContain(".range(from, from + pageSize - 1)");
    expect(taskUpdate).toContain("if (page.length < pageSize) break");
    expect(taskUpdate.match(/listActiveCustomersFromCache\(admin\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("não corta visualmente as opções após os primeiros 200 clientes", () => {
    expect(searchableSelect).not.toContain("filtered.slice(0, 200)");
    expect(searchableSelect.match(/filtered\.map\(\(option\)/g)?.length).toBe(2);
  });
});