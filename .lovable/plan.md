# Plan - Fix Client Update Duplication in RH module

The user reported that clicking to update a client's name (to match GestãoClick) in the RH module creates a new client instead of editing the existing one. This likely occurs because the synchronization logic or the manual link function in `rh-clientes-sync-gc` is creating new rows when it should be merging or updating existing ones, possibly due to unique constraint conflicts (like `gc_cliente_id` or `auvo_cliente_id`) being handled incorrectly.

## Proposed Changes

### Backend (Edge Function: `rh-clientes-sync-gc`)

1. **Fix `handleUpdateAuvoName`**:
   - Ensure it explicitly updates the existing `rh_clientes` record by its UUID (`rhClientId`) instead of relying on an upsert that might conflict.
   - Verify that `refreshAuvoNameReferences` doesn't inadvertently trigger new client creations in related tables.

2. **Improve `handleManualLink`**:
   - Strengthen the `mergeLocalCustomerDependencies` logic to ensure that if an Auvo ID is being linked to a GC-origin client, any existing "Auvo-only" row for that same ID is completely merged and deleted, preventing duplicates.

3. **Sync Logic Refinement**:
   - Review `fetchAllAuvoCustomers` and `fetchAllGcCustomers` loops to ensure they don't produce duplicate records in the `rh_clientes` table when names are similar but IDs match.
   - Adjust `upsertWithIsolation` usage to be more specific about which record it targets.

### Frontend (RH Clientes Page)

1. **Verify `handleUpdateAuvoNames` call**:
   - Confirm that the `selected` IDs passed to `updateAuvoClientNames` are correctly used to target existing records.
   - Ensure the UI correctly reflects the "Updated" state without showing duplicate rows until a full refetch completes.

## Technical Details

- **File**: `supabase/functions/rh-clientes-sync-gc/index.ts`
- **Logic**: The issue stems from the fact that `rh_clientes` has multiple unique keys (`id`, `gc_cliente_id`, `auvo_cliente_id`). When updating a name, if the sync process sees the new name and doesn't find a matching ID immediately (or finds a partial match), it might attempt to `insert` rather than `update`.
- **Constraint**: `ON CONFLICT (gc_cliente_id)` vs `ON CONFLICT (id)`. We must ensure we always use the UUID if available.
- **Merge Strategy**: When linking, if `auvo_cliente_id` already exists in another row, `mergeLocalCustomerDependencies` must be called to consolidate requirements and integrations before deleting the redundant row.
