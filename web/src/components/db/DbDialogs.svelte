<script lang="ts">
  // Host for the database dialogs, the shared context menu and the jobs panel.
  import { dialogs } from '../../lib/dbActions.svelte';
  import ContextMenu from '../ui/Menu.svelte';
  import CreateTableDialog from './CreateTableDialog.svelte';
  import DangerDialog from './DangerDialog.svelte';
  import DbFormDialog from './DbFormDialog.svelte';
  import ExportDialog from './ExportDialog.svelte';
  import ImportDialog from './ImportDialog.svelte';
  import JobsPanel from './JobsPanel.svelte';
  import TableOpsDialog from './TableOpsDialog.svelte';
  import DropObjectDialog from './DropObjectDialog.svelte';
  import BulkDialog from '../tools/BulkDialog.svelte';
  import GenerateDialog from '../tools/GenerateDialog.svelte';
  import MaintenanceDialog from '../tools/MaintenanceDialog.svelte';

  let lastFocus: HTMLElement | null = null;
  $effect(() => {
    if (dialogs.menu) lastFocus = document.activeElement as HTMLElement | null;
  });
</script>

{#if dialogs.req}
  {@const r = dialogs.req}
  {#key r}
    {#if r.kind === 'createDb'}<DbFormDialog />
    {:else if r.kind === 'editDb'}<DbFormDialog db={r.db} />
    {:else if r.kind === 'dropDb'}<DangerDialog kind="dropDb" db={r.db} />
    {:else if r.kind === 'truncate' || r.kind === 'drop'}<DangerDialog kind={r.kind} db={r.db} tables={r.tables} />
    {:else if r.kind === 'renameTable' || r.kind === 'copyTable'}<TableOpsDialog kind={r.kind} db={r.db} table={r.table} />
    {:else if r.kind === 'copyDb'}<TableOpsDialog kind="copyDb" db={r.db} />
    {:else if r.kind === 'createTable'}<CreateTableDialog db={r.db} />
    {:else if r.kind === 'export'}<ExportDialog db={r.db} tables={r.tables} />
    {:else if r.kind === 'import'}<ImportDialog db={r.db} />
    {:else if r.kind === 'dropObject'}<DropObjectDialog db={r.db} kind={r.objKind} name={r.name} />
    {:else if r.kind === 'maintenance'}<MaintenanceDialog db={r.db} tables={r.tables} />
    {:else if r.kind === 'bulk'}<BulkDialog db={r.db} tables={r.tables} />
    {:else if r.kind === 'generate'}<GenerateDialog db={r.db} table={r.table} />
    {/if}
  {/key}
{/if}

{#if dialogs.menu}
  <ContextMenu
    x={dialogs.menu.x}
    y={dialogs.menu.y}
    items={dialogs.menu.items}
    label={dialogs.menu.label}
    onclose={(refocus) => {
      dialogs.menu = null;
      if (refocus) lastFocus?.focus();
    }}
  />
{/if}

<JobsPanel />
