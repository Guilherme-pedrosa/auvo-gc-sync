import assert from "node:assert/strict";
import { test } from "node:test";
import { forceGcApiUserInRequest } from "../supabase/functions/_shared/gc-user-core.ts";

const API_USER = "1320473";
for (const identity of [undefined, null, "", "  ", "1023771"]) {
  test(`REST replaces absent/blank/personal identity: ${String(identity)}`, async () => {
    const query = identity === undefined ? "" : `?usuario_id=${encodeURIComponent(String(identity))}&usuario_id=1023771`;
    const payload = { usuario_id: identity, vendedor_id: "1023771", tecnico_id: "321", cliente_id: "77", produtos: [{ produto_id: "5", quantidade: "2.00" }] };
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const request = await forceGcApiUserInRequest(`https://api.gestaoclick.com/api/vendas/1${query}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, API_USER);
      assert.deepEqual(new URL(request.url).searchParams.getAll("usuario_id"), [API_USER]);
      assert.deepEqual(await request.json(), { ...payload, usuario_id: API_USER });
    }
    for (const method of ["GET", "HEAD"]) {
      const request = await forceGcApiUserInRequest(`https://api.gestaoclick.com/api/clientes${query}`, { method }, API_USER);
      assert.equal(new URL(request.url).searchParams.get("usuario_id"), API_USER);
    }
  });
}

test("Request/init overrides cannot restore the personal identity", async () => {
  const input = new Request("https://api.gestaoclick.com/api/vendas?usuario_id=1023771", {
    method: "PUT",
    body: JSON.stringify({ usuario_id: "1023771", vendedor_id: "99" }),
  });
  const request = await forceGcApiUserInRequest(input, {
    body: JSON.stringify({ usuario_id: null, vendedor_id: "99" }),
  }, API_USER);
  assert.deepEqual(await request.json(), { usuario_id: API_USER, vendedor_id: "99" });
  assert.equal(new URL(request.url).searchParams.get("usuario_id"), API_USER);
});

test("MCP preserves JSON-RPC and attributes only REST data for chamar_api", async () => {
  for (const supplied of [undefined, null, "", "1023771"]) {
    const rpc = { jsonrpc: "2.0", id: 42, method: "tools/call", params: {
      name: "chamar_api", arguments: { recurso: "vendas", acao: "editar", id: "7", dados: { usuario_id: supplied, vendedor_id: "1023771" } },
    } };
    const request = await forceGcApiUserInRequest("https://api.gestaoclick.com/mcp?usuario_id=1023771", {
      method: "POST", headers: { Accept: "application/json, text/event-stream" }, body: JSON.stringify(rpc),
    }, API_USER);
    const protectedRpc = await request.json();
    assert.deepEqual(protectedRpc, { ...rpc, params: { ...rpc.params, arguments: { ...rpc.params.arguments,
      dados: { usuario_id: API_USER, vendedor_id: "1023771" },
    } } });
    assert.equal(new URL(request.url).searchParams.get("usuario_id"), API_USER);
    assert.equal(request.headers.get("accept"), "application/json, text/event-stream");
    assert.equal(Object.hasOwn(protectedRpc, "usuario_id"), false);
  }
});

test("MCP initialization, notifications and tool discovery keep their envelopes", async () => {
  for (const rpc of [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {} } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "listar_recursos", arguments: {} } },
  ]) {
    const request = await forceGcApiUserInRequest("https://api.gestaoclick.com/mcp", {
      method: "POST", body: JSON.stringify(rpc),
    }, API_USER);
    assert.deepEqual(await request.json(), rpc);
  }
});

test("MCP goes directly to its protected endpoint; REST still uses its broker", async () => {
  const original = globalThis.fetch;
  const originalDeno = globalThis.Deno;
  const captured = [];
  globalThis.Deno = { env: { get: () => undefined } };
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    captured.push(request);
    return new URL(request.url).pathname === "/mcp"
      ? new Response('data: {"result":{}}\\n\\n', { headers: { "Content-Type": "text/event-stream" } })
      : new Response(JSON.stringify({ status: 200, data: { ok: true } }));
  };
  try {
    const { installGcUsuarioId } = await import("../supabase/functions/_shared/gc-user.ts");
    installGcUsuarioId();
    const response = await fetch("https://api.gestaoclick.com/mcp", {
      method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(new URL(captured[0].url).hostname, "api.gestaoclick.com");
    assert.equal(new URL(captured[0].url).searchParams.get("usuario_id"), API_USER);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    await fetch("https://api.gestaoclick.com/api/clientes?usuario_id=1023771");
    assert.equal(new URL(captured[1].url).pathname, "/functions/v1/gc-proxy");
    const body = await captured[1].json();
    assert.equal(new URL(body.endpoint, "https://api.gestaoclick.com").searchParams.get("usuario_id"), API_USER);
  } finally {
    globalThis.fetch = original;
    globalThis.Deno = originalDeno;
  }
});

