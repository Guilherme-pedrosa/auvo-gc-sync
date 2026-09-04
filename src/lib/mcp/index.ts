import { auth, defineMcp } from "@lovable.dev/mcp-js";
import buscarOrdensServico from "./tools/buscar-ordens-servico";
import consultarPreventivas from "./tools/consultar-preventivas";
import buscarEquipamentos from "./tools/buscar-equipamentos";
import observacoesOs from "./tools/observacoes-os";
import consultarAgenda from "./tools/consultar-agenda";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "auvo-gc-sync",
  title: "Auvo GC Sync",
  version: "0.1.0",
  instructions:
    "Ferramentas de leitura da operação Auvo + GestãoClick: ordens de serviço e orçamentos (Controle de OS), preventivas de equipamentos, cadastro de equipamentos, observações internas de OS e agenda da equipe. Cada usuário acessa somente os dados permitidos pela sua conta.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [buscarOrdensServico, consultarPreventivas, buscarEquipamentos, observacoesOs, consultarAgenda],
});
