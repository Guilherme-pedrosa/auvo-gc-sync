import { describe, expect, it } from "vitest";
import {
  buildRhClientAddressIndex,
  formatRhClientAddress,
  resolveOSMapAddress,
  type RhClientMapRow,
} from "@/lib/osMapAddress";

const linkedClient: RhClientMapRow = {
  id: "client-1",
  nome: "CLIENTE GC RIO VERDE",
  nome_gc: "CLIENTE GC RIO VERDE",
  nome_auvo: "CLIENTE AUVO KLAD",
  nome_fantasia: "UNIDADE RIO VERDE",
  endereco: "Rodovia BR 060, KM 380",
  cidade: "Rio Verde",
  uf: "GO",
  cep: "75901970",
  vinculo_status: "vinculado",
  ativo: true,
};

describe("endereços operacionais do mapa de OS", () => {
  it("preserva o endereço específico da tarefa como fonte prioritária", () => {
    const result = resolveOSMapAddress({
      endereco: "Rua da visita, 99, Goiânia - GO",
      cliente: linkedClient.nome_auvo,
      gc_os_cliente: linkedClient.nome_gc,
    }, buildRhClientAddressIndex([linkedClient]));

    expect(result).toMatchObject({
      address: "Rua da visita, 99, Goiânia - GO",
      source: "tarefa_auvo",
      issue: null,
    });
  });

  it("usa o vínculo oficial Auvo ↔ GC para recuperar o endereço do cliente", () => {
    const result = resolveOSMapAddress({
      endereco: null,
      cliente: "CLIENTE AUVO KLAD",
      gc_os_cliente: "CLIENTE GC RIO VERDE",
    }, buildRhClientAddressIndex([linkedClient]));

    expect(result.source).toBe("rh_clientes");
    expect(result.clientId).toBe("client-1");
    expect(result.address).toContain("Rodovia BR 060, KM 380");
    expect(result.address).toContain("Rio Verde - GO");
    expect(result.address).toContain("75901-970");
  });

  it("não herda o endereço de outra unidade quando o par de clientes não confere", () => {
    const result = resolveOSMapAddress({
      endereco: null,
      cliente: "CLIENTE AUVO KLAD",
      gc_os_cliente: "OUTRA UNIDADE GC",
    }, buildRhClientAddressIndex([linkedClient]));

    expect(result.address).toBeNull();
    expect(result.issue).toContain("sem vínculo correspondente");
  });

  it("diferencia cliente vinculado sem endereço de cliente não vinculado", () => {
    const withoutAddress = { ...linkedClient, endereco: null };
    const result = resolveOSMapAddress({
      cliente: withoutAddress.nome_auvo,
      gc_os_cliente: withoutAddress.nome_gc,
    }, buildRhClientAddressIndex([withoutAddress]));

    expect(result.address).toBeNull();
    expect(result.clientId).toBe("client-1");
    expect(result.issue).toContain("sem rua/número");
  });

  it("não cria ponto apenas com cidade quando falta logradouro", () => {
    expect(formatRhClientAddress({ ...linkedClient, endereco: "" })).toBeNull();
  });
});
