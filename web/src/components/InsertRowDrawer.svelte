<script lang="ts">
  import { ApiError, type ColumnInfo } from '../lib/api';
  import { familyOf, parseColumnType, parseEnumValues } from '../lib/columnTypes';
  import { friendlyError } from '../lib/errors';
  import { t } from '../lib/i18n.svelte';
  import { app } from '../lib/state.svelte';
  import { parseDefault } from '../lib/tableDraft';
  import Drawer from './structure/Drawer.svelte';
  import Switch from './structure/Switch.svelte';
  import RecordPicker from './objects/RecordPicker.svelte';
  import type { Link } from '../lib/fkLabels';

  let {
    db,
    table,
    columns,
    links = new Map(),
    onsave,
    onclose,
  }: {
    db: string;
    table: string;
    /** Relations of this table (declared and inferred): column -> target. */
    links?: Map<string, Link>;
    columns: ColumnInfo[];
    /** Resolve true when the row was inserted. */
    onsave: (values: Record<string, string | number | null>) => Promise<void>;
    onclose: () => void;
  } = $props();

  type Mode = 'default' | 'null' | 'value';
  interface Field {
    col: ColumnInfo;
    kind: 'auto' | 'generated' | 'ref' | 'enum' | 'bool' | 'date' | 'datetime' | 'time' | 'number' | 'longtext' | 'text';
    link: Link | null;
    /** The default as a value ('1', '0', 'abc'), when it is one. */
    defaultValue: string | null;
    options: string[];
    hasDefault: boolean;
    defaultText: string;
    required: boolean;
  }

  /** Yes/No defaults read "Yes"/"No"; numbers without quotes; text quoted. */
  function defaultValueText(parsed: { type: string; length: number | null }, fam: string, v: string): string {
    if (parsed.type === 'tinyint' && parsed.length === 1 && (v === '0' || v === '1')) return v === '1' ? t('common.yes') : t('common.no');
    if ((fam === 'int' || fam === 'decimal' || fam === 'float') && /^-?\d+(\.\d+)?$/.test(v)) return v;
    return `'${v}'`;
  }

  const fields = $derived<Field[]>(
    columns.map((c) => {
      const extra = c.extra.toLowerCase();
      const parsed = parseColumnType(c.type);
      const fam = familyOf(parsed.type);
      const d = parseDefault(c.default, c.nullable);
      const hasDefault = d.kind !== 'none' || extra.includes('auto_increment');
      const kind: Field['kind'] = extra.includes('auto_increment')
        ? 'auto'
        : /\b(virtual|stored|persistent) generated\b/.test(extra)
          ? 'generated'
          : links.has(c.name)
            ? 'ref'
            : fam === 'enum'
            ? 'enum'
            : parsed.type === 'tinyint' && parsed.length === 1
              ? 'bool'
              : parsed.type === 'date'
                ? 'date'
                : parsed.type === 'datetime' || parsed.type === 'timestamp'
                  ? 'datetime'
                  : parsed.type === 'time'
                    ? 'time'
                    : fam === 'int' || fam === 'decimal' || fam === 'float'
                      ? 'number'
                      : fam === 'text' || parsed.type === 'json'
                        ? 'longtext'
                        : 'text';
      return {
        col: c,
        kind,
        options: fam === 'enum' ? parseEnumValues(c.type.slice(c.type.indexOf('(') + 1, c.type.lastIndexOf(')'))) : [],
        hasDefault,
        link: links.get(c.name) ?? null,
        defaultValue: d.kind === 'value' ? (d.value ?? '') : null,
        defaultText: extra.includes('auto_increment')
          ? t('insert.auto')
          : d.kind === 'now'
            ? t('editor.default.now')
            : d.kind === 'null'
              ? 'NULL'
              : d.kind === 'value'
                ? defaultValueText(parsed, fam, d.value ?? '')
                : '',
        required: !hasDefault && !c.nullable,
      };
    }),
  );

  // Per column: use its default, NULL, or a typed value.
  let mode = $state<Record<string, Mode>>({});
  let value = $state<Record<string, string>>({});
  let error = $state('');
  let saving = $state(false);
  let again = $state(false);

  $effect(() => {
    for (const f of fields) {
      if (mode[f.col.name] === undefined) {
        mode[f.col.name] = f.hasDefault || f.kind === 'auto' || f.kind === 'generated' ? 'default' : 'value';
        value[f.col.name] = f.kind === 'bool' ? '0' : f.kind === 'enum' ? (f.options[0] ?? '') : '';
      }
    }
  });

  const missing = $derived(fields.filter((f) => f.required && mode[f.col.name] === 'value' && (value[f.col.name] ?? '') === '' && f.kind !== 'bool'));

  function setValue(name: string, v: string) {
    value[name] = v;
    mode[name] = 'value';
  }

  async function save() {
    if (missing.length) {
      error = t('insert.missing', { columns: missing.map((f) => f.col.name).join(', ') });
      return;
    }
    const out: Record<string, string | number | null> = {};
    for (const f of fields) {
      const m = mode[f.col.name];
      if (m === 'default' || f.kind === 'generated') continue;
      if (m === 'null') out[f.col.name] = null;
      else {
        let v = value[f.col.name] ?? '';
        if (f.kind === 'datetime') v = v.replace('T', ' ') + (v.length === 16 ? ':00' : '');
        out[f.col.name] = v;
      }
    }
    saving = true;
    error = '';
    try {
      await onsave(out);
      if (again) {
        mode = {};
        value = {};
      } else onclose();
    } catch (err) {
      error = err instanceof ApiError ? friendlyError(err, app.schema).title : String(err);
    } finally {
      saving = false;
    }
  }
</script>

<Drawer title={t('insert.title', { table })} {onclose} width={520}>
  <form
    class="form"
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}
  >
    <p class="help">{t('insert.help')}</p>
    {#each fields as f, i (f.col.name)}
      {@const name = f.col.name}
      {@const m = mode[name] ?? 'value'}
      <div class="field" class:muted={m !== 'value'}>
        <div class="label-row">
          <label for="ins-{i}" class="mono name">{name}{#if f.required}<span class="req" aria-hidden="true"> *</span>{/if}</label>
          <span class="type mono">{f.col.type}</span>
          <span class="spacer"></span>
          {#if f.kind !== 'auto' && f.kind !== 'generated'}
            <span class="modes" role="group" aria-label={t('insert.modeFor', { name })}>
              {#if f.hasDefault}
                <button type="button" class="mode" aria-pressed={m === 'default'} onclick={() => (mode[name] = 'default')} title={t('insert.useDefault')}>{t('insert.default')}</button>
              {/if}
              {#if f.col.nullable}
                <button type="button" class="mode" aria-pressed={m === 'null'} onclick={() => (mode[name] = 'null')}>NULL</button>
              {/if}
            </span>
          {/if}
        </div>
        {#if f.kind === 'auto'}
          <p class="note">{t('insert.autoHelp')}</p>
        {:else if f.kind === 'generated'}
          <p class="note">{t('insert.generatedHelp')}</p>
        {:else if f.kind === 'ref' && f.link}
          <RecordPicker
            {db}
            table={f.link.to}
            column={f.link.toColumn}
            id="ins-{i}"
            label={t('insert.pickFor', { name, table: f.link.to })}
            nullable={f.col.nullable}
            value={m === 'value' ? (value[name] || null) : null}
            onchange={(v) => (v === null ? (mode[name] = f.col.nullable ? 'null' : 'default') : setValue(name, v))}
          />
          {#if m !== 'value'}<p class="note">{m === 'null' ? 'NULL' : t('insert.defaultIs', { value: f.defaultText || '—' })}</p>{/if}
        {:else if f.kind === 'enum'}
          <select id="ins-{i}" class="v-input" value={m === 'value' ? value[name] : ''} onchange={(e) => setValue(name, (e.currentTarget as HTMLSelectElement).value)}>
            {#if m !== 'value'}<option value="" disabled>{m === 'null' ? 'NULL' : t('insert.defaultIs', { value: f.defaultText })}</option>{/if}
            {#each f.options as o}<option value={o}>{o}</option>{/each}
          </select>
        {:else if f.kind === 'bool'}
          <div class="bool">
            <Switch checked={m === 'value' ? value[name] === '1' : m === 'default' && f.defaultValue === '1'} label={name} onchange={(v) => setValue(name, v ? '1' : '0')} />
            <span>{m === 'value' ? (value[name] === '1' ? t('common.yes') : t('common.no')) : m === 'null' ? 'NULL' : t('insert.defaultIs', { value: f.defaultText })}</span>
          </div>
        {:else if f.kind === 'longtext'}
          <textarea
            id="ins-{i}"
            class="v-input mono"
            rows="3"
            value={m === 'value' ? value[name] : ''}
            placeholder={m === 'null' ? 'NULL' : m === 'default' ? t('insert.defaultIs', { value: f.defaultText || '—' }) : ''}
            oninput={(e) => setValue(name, (e.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
        {:else}
          <input
            id="ins-{i}"
            class="v-input"
            class:mono={f.kind !== 'text'}
            type={f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : f.kind === 'datetime' ? 'datetime-local' : f.kind === 'time' ? 'time' : 'text'}
            step={f.kind === 'number' ? 'any' : f.kind === 'datetime' || f.kind === 'time' ? '1' : undefined}
            maxlength={f.kind === 'text' ? (parseColumnType(f.col.type).length ?? undefined) : undefined}
            value={m === 'value' ? value[name] : ''}
            placeholder={m === 'null' ? 'NULL' : m === 'default' ? t('insert.defaultIs', { value: f.defaultText || '—' }) : ''}
            aria-invalid={missing.some((x) => x.col.name === name) && !!error}
            oninput={(e) => setValue(name, (e.currentTarget as HTMLInputElement).value)}
          />
        {/if}
        {#if f.col.comment}<p class="note">{f.col.comment}</p>{/if}
      </div>
    {/each}
    {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}
    <button type="submit" hidden>{t('insert.save')}</button>
  </form>
  {#snippet footer()}
    <label class="again"><input type="checkbox" bind:checked={again} /> {t('insert.again')}</label>
    <button class="v-btn-secondary" onclick={onclose}>{t('common.cancel')}</button>
    <button class="v-btn-primary" onclick={save} disabled={saving}>{saving ? t('insert.saving') : t('insert.save')}</button>
  {/snippet}
</Drawer>

<style>
  .form {
    display: grid;
    gap: 14px;
  }
  .help {
    margin: 0;
    font-size: 12.5px;
    color: var(--sp-text-secondary);
  }
  .field {
    display: grid;
    gap: 5px;
  }
  .label-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .name {
    font-size: 13px;
    font-weight: 600;
  }
  .req {
    color: var(--sp-danger);
  }
  .type {
    font-size: 11.5px;
    color: var(--sp-text-tertiary);
  }
  .spacer {
    flex: 1;
  }
  .modes {
    display: inline-flex;
    gap: 4px;
  }
  .mode {
    padding: 1px 8px;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    background: var(--sp-bg);
    font-size: 11.5px;
    cursor: pointer;
  }
  .mode[aria-pressed='true'] {
    border-color: var(--sp-inverse);
    background: var(--sp-inverse);
    color: var(--sp-on-inverse);
  }
  .muted :global(.v-input) {
    background: var(--sp-bg-subtle);
  }
  .bool {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .note {
    margin: 0;
    font-size: 12px;
    color: var(--sp-text-tertiary);
  }
  .again {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-right: auto;
    font-size: 12.5px;
  }
</style>
