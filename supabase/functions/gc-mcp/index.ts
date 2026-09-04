// Proxy para o servidor MCP oficial do GestãoClick (https://api.gestaoclick.com/mcp)
// Encaminha chamadas JSON-RPC do MCP usando as credenciais guardadas no backend.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GC_MCP_URL = "https://api.gestaoclick.com/mcp";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const accessToken = Deno.env.get("GC_ACCESS_TOKEN");
    const secretToken = Deno.env.get("GC_SECRET_TOKEN");
    if (!accessToken || !secretToken) {
      return new Response(
        JSON.stringify({ ok: false, error: "GC_CREDENTIALS_MISSING" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();

    const upstream = await fetch(GC_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Exigido pelo spec MCP Streamable HTTP
        Accept: "application/json, text/event-stream",
        "access-token": accessToken,
        "secret-access-token": secretToken,
      },
      body: JSON.stringify(body),
    });

    const contentType = upstream.headers.get("content-type") ?? "";

    if (contentType.includes("text/event-stream")) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.ok ? 200 : 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType.includes("json") ? "application/json" : "text/plain",
        "x-gc-mcp-status": String(upstream.status),
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: "GC_MCP_PROXY_ERROR", detail: String(err) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
