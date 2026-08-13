# Plan: Client Divergence Alerts (GC vs Auvo)

Implement visual alerts and logic to identify and display cases where the client information (specifically name and document) differs between GestãoClick (GC) and Auvo.

## User Review Required

> [!IMPORTANT]
> - Should name divergence only be flagged if there's a significant difference (e.g., more than just "LTDA" vs not)? 
> - For the OS detail view, do you want a prominent warning at the top or just next to the client names?

## Proposed Changes

### Logic & Backend (Supabase Edge Function)
- **`rh-clientes-sync-gc`**:
    - Enhance the synchronization logic to detect when `nome_gc` and `nome_auvo` (already stored in `rh_clientes`) are significantly different.
    - Add a "divergence check" during the sync process. If CNPJs match but names are very different, or if names match but CNPJs are different, mark the record.

### Hooks & State Management
- **`src/hooks/rh/useRh.ts`**:
    - Update the `RhCliente` type if necessary to include more explicit divergence flags.
    - Update `useRhClientes` and `useRhVinculosDuplicados` (or create a new hook `useRhDivergencias`) to identify rows where `nome_gc !== nome_auvo` or documents differ.

### Frontend Components

#### 1. RH > Clientes Page (`src/pages/rh/ClientesRhPage.tsx`)
- Add a new filter option "Divergência de Dados" in the "Situação do Vínculo" selector.
- Add a visual alert/badge (e.g., `AlertTriangle` in orange) in the table row when a divergence is detected between GC and Auvo columns.
- Show a tooltip or text explaining what exactly is different (Name, CNPJ, or both).

#### 2. OS/Agendamento Details (`src/components/operacional/TarefaAuvoDetalheDialog.tsx`)
- Inside the dialog, compare the client name from the Auvo task with the client name from the linked GC document.
- If they differ, show a prominent warning: "⚠️ Cliente divergente entre Auvo e GC".
- Display both names clearly so the user can see the mismatch (e.g., "Auvo: [Name]" and "GC: [Name]").

#### 3. Agendamento Equipe Dialog (`src/components/operacional/AgendamentoEquipeDialog.tsx`)
- Similar to the OS detail, show a warning if the selected/linked client from GC doesn't match the one expected in Auvo (if already linked).

## Technical Details
- Use the existing `normalize` function (strips accents, lowercase, removes common suffixes like LTDA/ME) to avoid false positives for name divergences.
- Implement a 70% token overlap logic (similar to `ClientDivergenceAlert` memory) to decide when a name is "different enough" to trigger a warning.
- Ensure the `rh_clientes` table remains the source of truth for these mappings.
