# Plan: Fix Shared OS Percentage and Calculation Logic

The user reported a discrepancy in OS splitting in the **Premiacao** (Technician Premium) module. Specifically, for OS 9938, the UI shows a technician with 154.02%, while they were supposed to have only ~20%. This suggests a bug in the percentage aggregation or distribution logic when an OS is shared between multiple technicians.

## Technical Details

1.  **Backend Analysis (`supabase/functions/premiacao/index.ts`):**
    *   The code iterates through `baseTecnicos` and their orders.
    *   For each OS that has a split defined in `premiacao_os_compartilhada`, it calculates a `pctCedido`.
    *   It then adjusts the "main" technician's row by reducing their share (e.g., if 20% is ceded, the main tech gets 80%).
    *   Crucially, it then *adds* the shared portions to other technicians.
    *   **The Bug:** Since an OS (like 9938) might appear in the list of multiple technicians (e.g., if the vendedor and the executor are different but were both part of the initial `baseTecnicos` list), the logic might be running the "split" process multiple times for the same OS. If technician A is the main tech and B is secondary (20%), and the OS appears once under A, A is reduced to 80% and B gets 20%. If for some reason the OS also appears under B in the initial list, it might try to split it again, leading to inflated percentages (like the 154% seen).
    *   **Proposed Fix:** Implement a set to track which OS IDs have already been processed for splitting within the `baseTecnicos` loop to ensure each OS is only split once.

2.  **Verification:**
    *   The logic for `existingIndex` in `secAgg.ordens` correctly prevents duplicate *rows* for the same technician, but it doesn't prevent the same OS from being processed as a "source" for splitting multiple times if it existed in the initial query multiple times (which happens when there are multiple `tarefas_central` rows for one OS).

## Proposed Changes

### Backend (`supabase/functions/premiacao/index.ts`)

-   Add a `processedSharedOs` set to track OS IDs during the sharing logic.
-   Skip splitting for an OS if it has already been processed in the current month's calculation.
-   Ensure that the "main" technician's original values are only reduced once.

### Logic Refinement

-   Verify the calculation of `pctCedido` and `escala` to ensure they don't produce values over 100% unless explicitly intended (though the user says it should be 20%).

No frontend changes are strictly required as the issue stems from the data returned by the backend.
