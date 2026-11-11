<script lang="ts">
  import { familyOf, type ColumnDef } from '../../lib/columnTypes';
  import { t } from '../../lib/i18n.svelte';
  import Drawer from './Drawer.svelte';
  import Switch from './Switch.svelte';
  import Select from '../ui/Select.svelte';

  let { def, collations, editable, onchange, onclose }: { def: ColumnDef; collations: string[]; editable: boolean; onchange: (d: ColumnDef) => void; onclose: () => void } = $props();

  const fam = $derived(familyOf(def.type));
  const textual = $derived(fam === 'char' || fam === 'text' || fam === 'enum');
  const set = <K extends keyof ColumnDef>(k: K, v: ColumnDef[K]) => onchange({ ...def, [k]: v });
</script>

<Drawer title={t('editor.advanced.title', { name: def.name })} {onclose} width={420}>
  <div class="form">
    {#if textual}
      <div class="field">
        <span>{t('editor.advanced.collation')}</span>
        <Select value={def.collation ?? ''} label={t('editor.advanced.collation')} disabled={!editable} mono options={[{ value: '', label: t('editor.advanced.tableDefault') }, ...collations.map((c) => ({ value: c, label: c }))]} onchange={(v) => set('collation', v || null)} />
      </div>
    {/if}
    {#if def.type === 'timestamp' || def.type === 'datetime'}
      <div class="row"><Switch checked={def.onUpdateNow} disabled={!editable} label={t('editor.advanced.onUpdate')} onchange={(v) => set('onUpdateNow', v)} /><span>{t('editor.advanced.onUpdate')} <code>ON UPDATE CURRENT_TIMESTAMP</code></span></div>
    {/if}
    {#if fam === 'int' || fam === 'decimal' || fam === 'float'}
      <div class="row"><Switch checked={def.zerofill} disabled={!editable} label="ZEROFILL" onchange={(v) => set('zerofill', v)} /><span>ZEROFILL <span class="dim">· {t('editor.advanced.zerofillHelp')}</span></span></div>
    {/if}
    <fieldset class="field">
      <legend>{t('editor.advanced.generated')}</legend>
      <p class="dim">{t('editor.advanced.generatedHelp')}</p>
      <textarea
        class="v-input mono"
        rows="3"
        placeholder="price * quantity"
        disabled={!editable}
        value={def.generated?.expr ?? ''}
        oninput={(e) => {
          const expr = (e.currentTarget as HTMLTextAreaElement).value;
          set('generated', expr.trim() ? { expr, stored: def.generated?.stored ?? false } : null);
        }}
        aria-label={t('editor.advanced.expression')}
      ></textarea>
      {#if def.generated}
        <div class="row"><Switch checked={def.generated.stored} disabled={!editable} label="STORED" onchange={(v) => set('generated', { expr: def.generated!.expr, stored: v })} /><span>{def.generated.stored ? 'STORED' : 'VIRTUAL'} <span class="dim">· {t('editor.advanced.storedHelp')}</span></span></div>
      {/if}
    </fieldset>
    <label class="field">
      <span>{t('editor.advanced.comment')}</span>
      <textarea class="v-input" rows="4" disabled={!editable} value={def.comment} oninput={(e) => set('comment', (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
    </label>
  </div>
</Drawer>

<style>
  .form {
    display: grid;
    gap: 16px;
  }
  .field {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
    font-size: 13px;
  }
  legend,
  .field > span {
    font-weight: 500;
    font-size: 13px;
    padding: 0;
  }
  .row {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 13px;
  }
  .dim {
    margin: 0;
    color: var(--sp-text-tertiary);
    font-size: 12px;
  }
  code {
    font-family: var(--sp-font-mono);
    font-size: 11.5px;
  }
</style>
