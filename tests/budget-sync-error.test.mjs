import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const source = readFileSync(new URL("../supabase/functions/budget-kanban/index.ts", import.meta.url), "utf8");
const start = source.indexOf("function syncErrorMessage(");
const end = source.indexOf("\nfunction databaseErrorText(", start);
const formatError = new Function("Deno", `${stripTypeScriptTypes(source.slice(start, end))}; return syncErrorMessage;`)({
  env: { get: (name) => name === "GC_SECRET_TOKEN" ? "fixture-secret" : undefined },
});

test("sync failure retains nested transport cause and redacts secrets", () => {
  const error = new Error("Falha no transporte do broker GestãoClick", {
    cause: new TypeError("rate limit: retry after 1000ms; fixture-secret; https://example.com/?token=hidden; Bearer hidden"),
  });
  const message = formatError(error);
  assert.match(message, /causa: rate limit: retry after 1000ms/);
  assert.doesNotMatch(message, /fixture-secret|example.com|hidden/);
});

test("sync failure bounds recursive causes and message length", () => {
  const error = new Error("cycle");
  error.cause = error;
  assert.equal(formatError(error), "cycle");
  assert.equal(formatError(new Error("x".repeat(2000))).length, 1000);
  assert.equal(formatError(null), "falha desconhecida");
});
