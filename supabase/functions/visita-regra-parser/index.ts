const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM = `Você interpreta regras de recorrência de visitas técnicas escritas em português do Brasil e converte para um calendário estruturado.

Contexto: cada contrato gera previsões de visita ao longo do ano. Os campos disponíveis são:
- qtd_visitas: quantas visitas acontecem em CADA mês ativo (inteiro >= 1)
- meses_ativos: array com os números dos meses (1..12) em que há visita. "a cada 2 meses" => [1,3,5,7,9,11]; "a cada 3 meses / trimestral" => [1,4,7,10]; "semestral" => [1,7]; "anual" => [1]; todo mês => 1..12
- semanas_mes: array de semanas do mês permitidas (1..5). "primeira e última semana" => [1,5]; "última semana" => [5]
- dias_semana: array 1=Seg 2=Ter 3=Qua 4=Qui 5=Sex 6=Sáb. Se não citado, use [1,2,3,4,5]
- hora_inicio: "HH:MM" (só preencha se o texto citar horário; senão null)
- qtd_tecnicos: número de técnicos por visita (só se citado; senão null)

Regras:
1. Nunca invente informação. Campo não citado e não dedutível => null.
2. Se o texto for ambíguo ou faltar algo essencial (ex.: "a cada 2 meses" sem dizer a partir de qual mês, ou "de manhã" sem hora), preencha o melhor palpite E liste perguntas objetivas em "perguntas" (máx. 3), cada uma curta e direta.
3. "confianca" entre 0 e 1.
4. "resumo" = uma frase em português descrevendo o que foi entendido.
5. Responda SOMENTE com JSON válido, sem markdown.

Formato: {"qtd_visitas":n|null,"meses_ativos":[..]|null,"semanas_mes":[..]|null,"dias_semana":[..]|null,"hora_inicio":"HH:MM"|null,"qtd_tecnicos":n|null,"confianca":0.0,"resumo":"...","perguntas":["..."]}`;

function coerceIntArray(value: unknown, min: number, max: number): number[] | null {
  if (!Array.isArray(value)) return null;
  const list = [...new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= min && item <= max))].sort((a, b) => a - b);
  return list.length ? list : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ ok: false, erro: "api_key_ausente", mensagem: "IA indisponível: chave não configurada." });

    const body = await req.json().catch(() => ({}));
    const texto = String(body?.texto || "").trim();
    if (!texto) return json({ ok: false, erro: "texto_vazio", mensagem: "Escreva a regra antes de interpretar." });

    const historico = Array.isArray(body?.historico) ? body.historico.slice(-6) : [];
    const mensagens = [
      { role: "system", content: SYSTEM },
      ...historico.map((item: any) => ({ role: item?.role === "assistant" ? "assistant" : "user", content: String(item?.content || "") })),
      { role: "user", content: texto },
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.7-flash",
        messages: mensagens,
        response_format: { type: "json_object" },
      }),
    });

    if (response.status === 429) return json({ ok: false, erro: "rate_limit", mensagem: "Muitas requisições à IA. Tente novamente em instantes." });
    if (response.status === 402) return json({ ok: false, erro: "sem_creditos", mensagem: "Créditos de IA esgotados. Adicione créditos no workspace." });
    if (!response.ok) {
      const detalhe = await response.text();
      return json({ ok: false, erro: "falha_ia", mensagem: `IA retornou ${response.status}`, detalhe: detalhe.slice(0, 400) });
    }

    const payload = await response.json();
    const raw = payload?.choices?.[0]?.message?.content ?? "";
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = String(raw).match(/\{[\s\S]*\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch { parsed = {}; } }
    }

    const horaBruta = typeof parsed?.hora_inicio === "string" ? parsed.hora_inicio.trim() : "";
    const hora = /^\d{1,2}:\d{2}$/.test(horaBruta)
      ? `${horaBruta.split(":")[0].padStart(2, "0")}:${horaBruta.split(":")[1]}`
      : null;

    const resultado = {
      qtd_visitas: Number.isInteger(parsed?.qtd_visitas) && parsed.qtd_visitas > 0 ? Math.min(31, parsed.qtd_visitas) : null,
      meses_ativos: coerceIntArray(parsed?.meses_ativos, 1, 12),
      semanas_mes: coerceIntArray(parsed?.semanas_mes, 1, 5),
      dias_semana: coerceIntArray(parsed?.dias_semana, 1, 6),
      hora_inicio: hora,
      qtd_tecnicos: Number.isInteger(parsed?.qtd_tecnicos) && parsed.qtd_tecnicos > 0 ? Math.min(10, parsed.qtd_tecnicos) : null,
      confianca: typeof parsed?.confianca === "number" ? Math.max(0, Math.min(1, parsed.confianca)) : 0.5,
      resumo: typeof parsed?.resumo === "string" ? parsed.resumo : "",
      perguntas: Array.isArray(parsed?.perguntas)
        ? parsed.perguntas.map((item: unknown) => String(item)).filter(Boolean).slice(0, 3)
        : [],
    };

    return json({ ok: true, resultado });
  } catch (error) {
    return json({ ok: false, erro: "excecao", mensagem: error instanceof Error ? error.message : String(error) });
  }
});
