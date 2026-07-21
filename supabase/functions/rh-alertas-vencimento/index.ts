import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'WAI ERP <onboarding@resend.dev>';
const EMAIL_ADMIN_TO = Deno.env.get('EMAIL_ADMIN_TO'); // destinatário do resumo
const ALERT_WINDOW_DAYS = Number(Deno.env.get('ALERT_WINDOW_DAYS') ?? '30');

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');

async function sendResend(to: string[], subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
    if (!EMAIL_ADMIN_TO) {
      return new Response(JSON.stringify({ ok: false, error: 'EMAIL_ADMIN_TO env não configurada' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const today = new Date();
    const limit = new Date();
    limit.setDate(today.getDate() + ALERT_WINDOW_DAYS);
    const todayIso = today.toISOString().slice(0, 10);
    const limitIso = limit.toISOString().slice(0, 10);

    // ASOs vigentes vencendo ou vencidos
    const { data: asos = [] } = await sb
      .from('med_aso')
      .select('id, colaborador_id, data_validade, vigente, colaborador:rh_colaboradores(nome), tipo:med_tipos_aso(nome)')
      .eq('vigente', true)
      .lte('data_validade', limitIso)
      .order('data_validade', { ascending: true });

    // Documentos RH vencendo
    const { data: docs = [] } = await sb
      .from('rh_colaborador_docs')
      .select('id, colaborador_id, data_vencimento, tipo_customizado, colaborador:rh_colaboradores(nome), tipo:rh_document_types(nome)')
      .not('data_vencimento', 'is', null)
      .lte('data_vencimento', limitIso)
      .order('data_vencimento', { ascending: true });

    if (!asos.length && !docs.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0, message: 'Nenhum vencimento na janela' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const row = (nome: string, tipo: string, data: string) => {
      const vencido = data < todayIso;
      const cor = vencido ? '#dc2626' : '#d97706';
      const tag = vencido ? 'VENCIDO' : 'A VENCER';
      return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${nome}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${tipo}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${fmt(data)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;color:${cor};font-weight:600">${tag}</td></tr>`;
    };

    const asoRows = (asos as any[])
      .map((a) => row(a.colaborador?.nome ?? '—', `ASO • ${a.tipo?.nome ?? ''}`, a.data_validade))
      .join('');
    const docRows = (docs as any[])
      .map((d) => row(d.colaborador?.nome ?? '—', d.tipo?.nome ?? d.tipo_customizado ?? 'Documento', d.data_vencimento))
      .join('');

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;color:#111;max-width:720px;margin:0 auto">
        <h2 style="margin:0 0 4px">Alertas de vencimento – RH</h2>
        <p style="color:#555;margin:0 0 16px">Janela: próximos ${ALERT_WINDOW_DAYS} dias (${fmt(todayIso)} → ${fmt(limitIso)})</p>
        <h3 style="margin:16px 0 6px">ASOs (${asos.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f3f4f6"><th align="left" style="padding:6px 10px">Colaborador</th><th align="left" style="padding:6px 10px">Tipo</th><th align="left" style="padding:6px 10px">Validade</th><th align="left" style="padding:6px 10px">Status</th></tr></thead>
          <tbody>${asoRows || '<tr><td colspan="4" style="padding:8px;color:#888">Nenhum</td></tr>'}</tbody>
        </table>
        <h3 style="margin:24px 0 6px">Documentos (${docs.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f3f4f6"><th align="left" style="padding:6px 10px">Colaborador</th><th align="left" style="padding:6px 10px">Tipo</th><th align="left" style="padding:6px 10px">Vencimento</th><th align="left" style="padding:6px 10px">Status</th></tr></thead>
          <tbody>${docRows || '<tr><td colspan="4" style="padding:8px;color:#888">Nenhum</td></tr>'}</tbody>
        </table>
        <p style="color:#888;font-size:12px;margin-top:24px">Enviado automaticamente pelo WAI ERP.</p>
      </div>`;

    const to = EMAIL_ADMIN_TO.split(',').map((s) => s.trim()).filter(Boolean);
    const send = await sendResend(to, `Vencimentos RH – ${asos.length} ASOs, ${docs.length} docs`, html);

    return new Response(JSON.stringify({ ok: send.ok, asos: asos.length, docs: docs.length, resend: send }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('rh-alertas-vencimento crashed', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});