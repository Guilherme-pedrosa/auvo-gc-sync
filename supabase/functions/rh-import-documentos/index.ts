// Edge Function: rh-import-documentos
// Recebe documentos de RH de um importador local, protegido por X-Import-Token.
// - Modo inventory/dry-run: retorna colaboradores, tipos e documentos existentes.
// - Upload multipart: 1 arquivo por request + metadados; upserta com regras anti-duplicidade.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-import-token",
};

const BUCKET = "rh-documentos";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeDoc(v: string | null | undefined) {
  return (v ?? "").replace(/\D+/g, "");
}

function normalizeNome(v: string | null | undefined) {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(ltda|me|eireli|epp|sa|s\/a|s\.a\.)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeExt(name: string) {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(name || "");
  return m ? `.${m[1].toLowerCase()}` : "";
}

function parseDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // aceita YYYY-MM-DD ou DD/MM/YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth: token compartilhado
  const expected = Deno.env.get("RH_IMPORT_TOKEN");
  const provided = req.headers.get("x-import-token") ?? "";
  if (!expected || provided !== expected) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "";
  const contentType = req.headers.get("content-type") ?? "";

  try {
    // ---------- INVENTORY / DRY-RUN ----------
    if (mode === "inventory" || mode === "dry-run") {
      const [cols, tipos, docs] = await Promise.all([
        supabase
          .from("rh_colaboradores")
          .select("id, nome, cpf_cnpj, tipo_pessoa, ativo, cargo, funcao"),
        supabase
          .from("rh_document_types")
          .select("id, code, name, scope, requires_expiry, ativo"),
        supabase
          .from("rh_colaborador_docs")
          .select(
            "id, colaborador_id, document_type_id, data_emissao, data_vencimento, arquivo_nome, arquivo_sha256"
          ),
      ]);
      if (cols.error) throw cols.error;
      if (tipos.error) throw tipos.error;
      if (docs.error) throw docs.error;
      return json({
        ok: true,
        mode: "inventory",
        colaboradores: cols.data,
        document_types: tipos.data,
        documentos: docs.data,
      });
    }

    // ---------- UPLOAD ----------
    if (!contentType.includes("multipart/form-data")) {
      return json(
        {
          ok: false,
          error: "expected multipart/form-data or ?mode=inventory",
        },
        400
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ ok: false, error: "missing file field" }, 400);
    }

    // metadados
    const colaboradorCpfCnpj = normalizeDoc(String(form.get("cpf_cnpj") ?? ""));
    const colaboradorNome = String(form.get("nome") ?? "").trim();
    const tipoPessoa =
      (String(form.get("tipo_pessoa") ?? "PJ") || "PJ").toUpperCase() === "PF"
        ? "PF"
        : "PJ";
    const cargo = String(form.get("cargo") ?? "Técnico");
    const funcao = String(form.get("funcao") ?? "Técnico de Manutenção");
    const email = String(form.get("email") ?? "") || null;
    const telefone = String(form.get("telefone") ?? "") || null;

    const documentTypeId = String(form.get("document_type_id") ?? "").trim();
    const documentTypeCode = String(form.get("document_type_code") ?? "").trim();
    const tipoCustomizado =
      String(form.get("tipo_customizado") ?? "").trim() || null;
    const dataEmissao = parseDate(form.get("data_emissao"));
    const dataVencimento = parseDate(form.get("data_vencimento"));
    const observacoes = String(form.get("observacoes") ?? "") || null;
    const providedHash = String(form.get("sha256") ?? "").toLowerCase().trim();

    if (!colaboradorCpfCnpj && !colaboradorNome) {
      return json(
        { ok: false, error: "colaborador: cpf_cnpj ou nome obrigatório" },
        400
      );
    }

    // Resolve document_type
    let docType: { id: string; code: string; name: string } | null = null;
    if (documentTypeId) {
      const { data, error } = await supabase
        .from("rh_document_types")
        .select("id, code, name")
        .eq("id", documentTypeId)
        .maybeSingle();
      if (error) throw error;
      docType = data;
    } else if (documentTypeCode) {
      const { data, error } = await supabase
        .from("rh_document_types")
        .select("id, code, name")
        .eq("code", documentTypeCode)
        .maybeSingle();
      if (error) throw error;
      docType = data;
    }
    if (!docType) {
      return json(
        { ok: false, error: "document_type_id/code inválido ou não encontrado" },
        400
      );
    }

    // Resolve/cria colaborador — primeiro CPF/CNPJ, depois nome normalizado
    let colaboradorId: string | null = null;
    if (colaboradorCpfCnpj) {
      const { data, error } = await supabase
        .from("rh_colaboradores")
        .select("id, cpf_cnpj, nome")
        .not("cpf_cnpj", "is", null);
      if (error) throw error;
      const hit = (data ?? []).find(
        (c: any) => normalizeDoc(c.cpf_cnpj) === colaboradorCpfCnpj
      );
      if (hit) colaboradorId = hit.id;
    }
    if (!colaboradorId && colaboradorNome) {
      const alvo = normalizeNome(colaboradorNome);
      const { data, error } = await supabase
        .from("rh_colaboradores")
        .select("id, nome");
      if (error) throw error;
      const hit = (data ?? []).find(
        (c: any) => normalizeNome(c.nome) === alvo
      );
      if (hit) colaboradorId = hit.id;
    }

    if (!colaboradorId) {
      // cadastra técnico padrão PJ ativo
      const insertPayload: Record<string, unknown> = {
        nome: colaboradorNome || `Técnico ${colaboradorCpfCnpj}`,
        tipo_pessoa: tipoPessoa,
        cpf_cnpj: colaboradorCpfCnpj || null,
        cargo: cargo || "Técnico",
        funcao: funcao || "Técnico de Manutenção",
        ativo: true,
        email,
        telefone,
      };
      const { data, error } = await supabase
        .from("rh_colaboradores")
        .insert(insertPayload)
        .select("id")
        .single();
      if (error) throw error;
      colaboradorId = data.id;
    }

    // Lê buffer + calcula hash
    const buf = await file.arrayBuffer();
    const hash = await sha256Hex(buf);
    if (providedHash && providedHash !== hash) {
      return json(
        {
          ok: false,
          status: "error",
          error: "sha256 mismatch",
          expected: providedHash,
          got: hash,
        },
        400
      );
    }

    // 1) Duplicidade global por hash
    {
      const { data: dupHash, error } = await supabase
        .from("rh_colaborador_docs")
        .select("id, colaborador_id, document_type_id")
        .eq("arquivo_sha256", hash)
        .limit(1);
      if (error) throw error;
      if (dupHash && dupHash.length > 0) {
        return json({
          ok: true,
          status: "skipped_duplicate",
          reason: "sha256 já cadastrado",
          existing_doc_id: dupHash[0].id,
          colaborador_id: colaboradorId,
          document_type_id: docType.id,
          sha256: hash,
        });
      }
    }

    // 2) Existente por (colaborador, tipo)
    const { data: existing, error: exErr } = await supabase
      .from("rh_colaborador_docs")
      .select(
        "id, data_vencimento, data_emissao, arquivo_sha256, arquivo_url, arquivo_nome"
      )
      .eq("colaborador_id", colaboradorId)
      .eq("document_type_id", docType.id)
      .order("atualizado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (exErr) throw exErr;

    // regra: nunca substituir por versão mais antiga/vencida
    if (existing) {
      const today = new Date().toISOString().slice(0, 10);
      const newVenc = dataVencimento;
      const oldVenc = existing.data_vencimento as string | null;

      const newIsExpired = newVenc ? newVenc < today : false;
      const oldIsExpired = oldVenc ? oldVenc < today : false;

      // Se novo é vencido e o existente não está vencido, pula
      if (newIsExpired && !oldIsExpired) {
        return json({
          ok: true,
          status: "skipped_older",
          reason: "arquivo enviado está vencido; existente é válido",
          existing_doc_id: existing.id,
          colaborador_id: colaboradorId,
          document_type_id: docType.id,
        });
      }

      // Se ambos têm vencimento, mantém o mais recente
      if (newVenc && oldVenc && newVenc <= oldVenc) {
        return json({
          ok: true,
          status: "skipped_older",
          reason: `data_vencimento ${newVenc} <= existente ${oldVenc}`,
          existing_doc_id: existing.id,
          colaborador_id: colaboradorId,
          document_type_id: docType.id,
        });
      }

      // Se existente tem vencimento e novo não tem — assumimos que novo é indefinido/antigo
      if (!newVenc && oldVenc && !oldIsExpired) {
        return json({
          ok: true,
          status: "skipped_older",
          reason: "existente possui vencimento válido; novo sem vencimento",
          existing_doc_id: existing.id,
          colaborador_id: colaboradorId,
          document_type_id: docType.id,
        });
      }
    }

    // Upload no bucket privado
    const ext = safeExt(file.name);
    const storagePath = `${colaboradorId}/${docType.code}/${hash}${ext}`;
    const bytes = new Uint8Array(buf);
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });
    if (upErr) throw upErr;

    const payload = {
      colaborador_id: colaboradorId,
      document_type_id: docType.id,
      tipo_customizado: tipoCustomizado,
      data_emissao: dataEmissao,
      data_vencimento: dataVencimento,
      arquivo_url: storagePath,
      arquivo_nome: file.name,
      arquivo_sha256: hash,
      observacoes,
    };

    if (existing) {
      const { data, error } = await supabase
        .from("rh_colaborador_docs")
        .update(payload)
        .eq("id", existing.id)
        .select("id")
        .single();
      if (error) throw error;
      return json({
        ok: true,
        status: "updated",
        doc_id: data.id,
        colaborador_id: colaboradorId,
        document_type_id: docType.id,
        storage_path: storagePath,
        sha256: hash,
      });
    } else {
      const { data, error } = await supabase
        .from("rh_colaborador_docs")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      return json({
        ok: true,
        status: "created",
        doc_id: data.id,
        colaborador_id: colaboradorId,
        document_type_id: docType.id,
        storage_path: storagePath,
        sha256: hash,
      });
    }
  } catch (err) {
    console.error("[rh-import-documentos] error", err);
    return json(
      { ok: false, status: "error", error: String((err as Error).message ?? err) },
      200
    );
  }
});