import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import {
  forceGcApiUserInBody,
  forceGcApiUserInHeaders,
  forceGcApiUserInRequest,
  forceGcApiUserInUrl,
  isGestaoClickApiUrl,
} from "../../supabase/functions/_shared/gc-user-core.ts";

const API_USER_ID = "1320473";
const projectRoot = process.cwd();

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    return entry.isDirectory()
      ? collectTypeScriptFiles(fullPath)
      : extname(entry.name).match(/^\.tsx?$/)
        ? [fullPath]
        : [];
  });
}

describe("proteção do usuário técnico da API GestãoClick", () => {
  it("reconhece somente o host oficial da API", () => {
    expect(isGestaoClickApiUrl("https://api.gestaoclick.com/api/ordens_servicos")).toBe(true);
    expect(isGestaoClickApiUrl("https://api.gestaoclick.com.evil.test/api")).toBe(false);
    expect(isGestaoClickApiUrl("https://gestaoclick.com/api")).toBe(false);
  });

  it("adiciona o usuário técnico quando ele não existe na URL", () => {
    const url = new URL(forceGcApiUserInUrl("https://api.gestaoclick.com/api/clientes?page=2", API_USER_ID));
    expect(url.searchParams.get("usuario_id")).toBe(API_USER_ID);
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("substitui um usuário humano já presente na URL", () => {
    const url = new URL(forceGcApiUserInUrl("https://api.gestaoclick.com/api/clientes?usuario_id=guilherme", API_USER_ID));
    expect(url.searchParams.get("usuario_id")).toBe(API_USER_ID);
  });

  it("substitui um usuário humano já presente nos cabeçalhos", () => {
    const headers = forceGcApiUserInHeaders({ "usuario-id": "guilherme", "x-trace": "abc" }, API_USER_ID);
    expect(headers.get("usuario-id")).toBe(API_USER_ID);
    expect(headers.get("x-trace")).toBe("abc");
  });

  it("substitui o usuário do payload e preserva os demais campos", () => {
    const protectedBody = forceGcApiUserInBody(
      JSON.stringify({ usuario_id: "guilherme", situacao_id: "7116099" }),
      API_USER_ID,
    );

    expect(JSON.parse(String(protectedBody))).toEqual({
      usuario_id: API_USER_ID,
      situacao_id: "7116099",
    });
  });

  it("adiciona o usuário ao payload quando o campo não existe", () => {
    const protectedBody = forceGcApiUserInBody(JSON.stringify({ nome: "Teste" }), API_USER_ID);
    expect(JSON.parse(String(protectedBody))).toEqual({ nome: "Teste", usuario_id: API_USER_ID });
  });

  it("protege URL, cabeçalho e corpo mesmo quando Request e init tentam usar outro usuário", async () => {
    const input = new Request(
      "https://api.gestaoclick.com/api/ordens_servicos/1?usuario_id=usuario-original",
      {
        method: "PUT",
        headers: { "usuario-id": "usuario-original", "Content-Type": "application/json" },
        body: JSON.stringify({ usuario_id: "usuario-original", situacao_id: "1" }),
      },
    );

    const protectedRequest = await forceGcApiUserInRequest(input, {
      headers: { "usuario-id": "guilherme", "Content-Type": "application/json" },
      body: JSON.stringify({ usuario_id: "guilherme", situacao_id: "2" }),
    }, API_USER_ID);

    expect(new URL(protectedRequest.url).searchParams.get("usuario_id")).toBe(API_USER_ID);
    expect(protectedRequest.headers.get("usuario-id")).toBe(API_USER_ID);
    expect(await protectedRequest.json()).toEqual({ usuario_id: API_USER_ID, situacao_id: "2" });
  });

  it("bloqueia proteção com ID técnico vazio", () => {
    expect(() => forceGcApiUserInUrl("https://api.gestaoclick.com/api/clientes", " ")).toThrow();
    expect(() => forceGcApiUserInHeaders({}, " ")).toThrow();
    expect(() => forceGcApiUserInBody("{}", " ")).toThrow();
  });

  it("mantém todas as Edge Functions do GC cobertas pelo bloqueio global", () => {
    const functionsDirectory = join(projectRoot, "supabase", "functions");
    const offenders = collectTypeScriptFiles(functionsDirectory)
      .filter((file) => !file.includes(`${join("supabase", "functions", "_shared")}`))
      .filter((file) => readFileSync(file, "utf8").includes("api.gestaoclick.com"))
      .filter((file) => !readFileSync(file, "utf8").includes("installGcUsuarioId();"))
      .map((file) => relative(projectRoot, file));

    expect(offenders).toEqual([]);
  });

  it("impede a interface de enviar o usuário pessoal ao sincronizador", () => {
    const sourceDirectory = join(projectRoot, "src");
    const offenders = collectTypeScriptFiles(sourceDirectory)
      .filter((file) => /gc_usuario_id\s*:/.test(readFileSync(file, "utf8")))
      .map((file) => relative(projectRoot, file));

    expect(offenders).toEqual([]);
  });
});
