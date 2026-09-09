import assert from "node:assert/strict";
import { test } from "node:test";
import { forceGcApiUserInRequest } from "../supabase/functions/_shared/gc-user-core.ts";

async function withGcWrapper(transport, run) {
  const savedDeno = globalThis.Deno;
  globalThis.Deno = { env: { get: () => undefined } };
  try {
    const { createGcFetch } = await import("../supabase/functions/_shared/gc-user.ts");
    await run(createGcFetch(transport));
  } finally {
    globalThis.Deno = savedDeno;
  }
}

test("broker retries transient network failures only for logical GET/HEAD and keeps API attribution", async () => {
  for (const method of ["GET", "HEAD"]) {
    const calls = [];
    await withGcWrapper(async (input, init) => {
      calls.push(new Request(input, init));
      if (calls.length === 1) throw new TypeError("fetch failed");
      return Response.json({ status: 200, data: { data: [{ id: "fixture" }] } });
    }, async (gcFetch) => {
      const response = await gcFetch("https://api.gestaoclick.com/api/orcamentos?pagina=1&usuario_id=1023771", { method });
      assert.equal(response.status, 200);
      assert.equal(calls.length, 2);
      for (const call of calls) {
        assert.equal(new URL(call.url).pathname, "/functions/v1/gc-proxy");
        const envelope = await call.json();
        assert.equal(envelope.method, method);
        assert.equal(new URL(envelope.endpoint, "https://api.gestaoclick.com").searchParams.get("usuario_id"), API_USER);
      }
      if (method === "HEAD") assert.equal(await response.text(), "");
      else assert.deepEqual(await response.json(), { data: [{ id: "fixture" }] });
    });
  }
});

test("persistent read network failure stops after three broker attempts and reports transport", async () => {
  let calls = 0;
  const cause = new TypeError("fetch failed");
  await withGcWrapper(async () => { calls++; throw cause; }, async (gcFetch) => {
    await assert.rejects(gcFetch("https://api.gestaoclick.com/api/orcamentos"), (error) => {
      assert.match(error.message, /transporte do broker/);
      assert.doesNotMatch(error.message, /garantir o usuário/);
      assert.equal(error.cause, cause);
      return true;
    });
    assert.equal(calls, 3);
  });
});

test("network failures never repeat business writes and preserve commercial fields", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const calls = [];
    await withGcWrapper(async (input, init) => {
      calls.push(new Request(input, init));
      throw new TypeError("fetch failed");
    }, async (gcFetch) => {
      await assert.rejects(gcFetch("https://api.gestaoclick.com/api/orcamentos/7", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario_id: "1023771", vendedor_id: "55", tecnico_id: "66" }),
      }), /transporte do broker/);
      assert.equal(calls.length, 1);
      const envelope = await calls[0].json();
      assert.deepEqual(envelope.payload, { usuario_id: API_USER, vendedor_id: "55", tecnico_id: "66" });
    });
  }
});

test("header errors are not retried or mistaken for temporary network failures", async () => {
  let calls = 0;
  await withGcWrapper(async () => {
    calls++;
    throw new TypeError("Invalid header value");
  }, async (gcFetch) => {
    await assert.rejects(gcFetch("https://api.gestaoclick.com/api/orcamentos"), /transporte do broker/);
    assert.equal(calls, 1);
    await assert.rejects(gcFetch("https://api.gestaoclick.com/api/orcamentos", {
      headers: { "x-test": "invalid\nfixture" },
    }), /garantir o usuário/);
    assert.equal(calls, 1, "invalid input headers must fail before transport");
  });
});

test("cancellation before or during transport is preserved and never retried", async () => {
  const alreadyAborted = new AbortController();
  const stopped = new Error("fixture cancellation");
  alreadyAborted.abort(stopped);
  let calls = 0;
  await withGcWrapper(async () => { calls++; return Response.json({ status: 200, data: {} }); }, async (gcFetch) => {
    await assert.rejects(gcFetch("https://api.gestaoclick.com/api/orcamentos", { signal: alreadyAborted.signal }), (error) => error === stopped);
    assert.equal(calls, 0);
  });
  const controller = new AbortController();
  const abortError = new DOMException("fixture cancellation", "AbortError");
  await withGcWrapper(async () => { calls++; controller.abort(abortError); throw abortError; }, async (gcFetch) => {
    await assert.rejects(gcFetch("https://api.gestaoclick.com/api/orcamentos", { signal: controller.signal }), (error) => error === abortError);
    assert.equal(calls, 1);
  });
  calls = 0;
  const interruptedBody = new Request("https://api.gestaoclick.com/api/orcamentos", {
    method: "POST", duplex: "half",
    body: new ReadableStream({ start(stream) { stream.error(abortError); } }),
  });
  await withGcWrapper(async () => { calls++; }, async (gcFetch) => {
    await assert.rejects(gcFetch(interruptedBody), (error) => error.name === "AbortError");
    assert.equal(calls, 0);
  });
});

test("broker envelopes preserve valid upstream success and failure HTTP statuses without retries", async () => {
  for (const status of [200, 201, "200", 400, 401, 429, 500, 503]) {
    let calls = 0;
    const data = { message: "fixture upstream response" };
    await withGcWrapper(async () => { calls++; return Response.json({ status, data }); }, async (gcFetch) => {
      const response = await gcFetch("https://api.gestaoclick.com/api/orcamentos");
      assert.equal(response.status, Number(status));
      assert.deepEqual(await response.json(), data);
      assert.equal(calls, 1);
    });
  }
});

test("204/205/304 broker envelopes produce valid bodyless responses", async () => {
  for (const status of [204, 205, 304]) {
    await withGcWrapper(async () => Response.json({ status, data: { ignored: true } }), async (gcFetch) => {
      const response = await gcFetch("https://api.gestaoclick.com/api/orcamentos");
      assert.equal(response.status, status);
      assert.equal(response.body, null);
      assert.equal(await response.text(), "");
    });
  }
});

test("invalid broker JSON, envelopes and statuses fail explicitly instead of reporting empty success", async () => {
  const invalid = [
    "not JSON", "null", "[]", "{}", JSON.stringify({ data: {} }),
    ...["success", null, true, 0, 199, 600, 200.5].map((status) => JSON.stringify({ status, data: {} })),
    JSON.stringify({ status: 200 }), JSON.stringify({ status: 200, error: "fixture failure" }),
  ];
  for (const body of invalid) {
    let calls = 0;
    await withGcWrapper(async () => { calls++; return new Response(body, { status: 200 }); }, async (gcFetch) => {
      await assert.rejects(gcFetch("https://api.gestaoclick.com/api/orcamentos"), (error) => {
        assert.match(error.message, /Resposta inválida do broker/);
        assert.doesNotMatch(error.message, /garantir o usuário/);
        return true;
      });
      assert.equal(calls, 1);
    });
  }
});

test("broker HTTP failure remains an HTTP failure and is never retried by this wrapper", async () => {
  let calls = 0;
  const unavailable = Response.json({ error: "fixture unavailable" }, { status: 503 });
  await withGcWrapper(async () => { calls++; return unavailable; }, async (gcFetch) => {
    assert.equal(await gcFetch("https://api.gestaoclick.com/api/orcamentos"), unavailable);
    assert.equal(calls, 1);
  });
});

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
