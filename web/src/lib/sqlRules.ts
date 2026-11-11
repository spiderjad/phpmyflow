/*
 * Hand-written SQL rules that run in the browser before the parser and the
 * server. node-sql-parser is lenient (it accepts `LIMIT 10 ORDER BY x`) and
 * its errors are generic; these rules catch the everyday mistakes with a
 * precise position, a clear message and, when safe, a quick fix.
 *
 * Pure and UI-free: messages are i18n keys + params, offsets are relative
 * to the statement text passed in. sqlLint.ts and the result panel
 * translate them and shift the offsets.
 */
import type { SchemaMap } from './api';
import { closest } from './levenshtein';

export type Severity = 'error' | 'warning';

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface RuleFix {
  key: string;
  params?: Record<string, string>;
  changes: TextChange[];
}

export interface RuleDiagnostic {
  rule:
    | 'clause-order'
    | 'clause-twice'
    | 'extra-comma'
    | 'missing-comma'
    | 'unclosed-paren'
    | 'extra-paren'
    | 'unclosed-quote'
    | 'unknown-alias'
    | 'duplicate-alias'
    | 'null-compare'
    | 'no-where'
    | 'reserved-word'
    | 'double-quote-ident';
  severity: Severity;
  from: number;
  to: number;
  key: string;
  params: Record<string, string>;
  fixes: RuleFix[];
}

// --------------------------------------------------------------------------
// Lexer
// --------------------------------------------------------------------------

export type TokenType = 'word' | 'ident' | 'string' | 'number' | 'punct' | 'op';

export interface Token {
  type: TokenType;
  /** Raw text as written. */
  text: string;
  /** Uppercased text for words; unquoted name for backtick identifiers. */
  value: string;
  from: number;
  to: number;
  /** Paren depth before this token. */
  depth: number;
  /** Index (in tokens) of the enclosing "(", or -1 at the top level. */
  group: number;
  quote?: "'" | '"' | '`';
  unterminated?: boolean;
}

const WORD_START = /[A-Za-z_$@\u0080-￿]/;
const WORD_CHAR = /[\w$@\u0080-￿]/;
const OPS = ['<=>', '->>', '>=', '<=', '<>', '!=', ':=', '->', '||', '&&', '<<', '>>'];

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  const stack: number[] = [];
  let i = 0;
  const push = (type: TokenType, from: number, to: number, extra: Partial<Token> = {}) => {
    const text = sql.slice(from, to);
    tokens.push({
      type,
      text,
      value: type === 'word' ? text.toUpperCase() : text,
      from,
      to,
      depth: stack.length,
      group: stack.length ? stack[stack.length - 1] : -1,
      ...extra,
    });
  };
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (/\s/.test(ch)) {
      i++;
    } else if ((ch === '-' && next === '-' && (sql[i + 2] === undefined || /\s/.test(sql[i + 2]))) || ch === '#') {
      const j = sql.indexOf('\n', i);
      i = j === -1 ? sql.length : j;
    } else if (ch === '/' && next === '*') {
      const j = sql.indexOf('*/', i + 2);
      i = j === -1 ? sql.length : j + 2;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      let closed = false;
      while (j < sql.length) {
        if (ch !== '`' && sql[j] === '\\') j += 2;
        else if (sql[j] === ch && sql[j + 1] === ch) j += 2;
        else if (sql[j] === ch) {
          closed = true;
          break;
        } else j++;
      }
      const end = closed ? j + 1 : sql.length;
      const inner = sql.slice(i + 1, closed ? j : sql.length);
      if (ch === '`') push('ident', i, end, { value: inner.replace(/``/g, '`'), quote: '`', unterminated: !closed });
      else push('string', i, end, { value: inner, quote: ch, unterminated: !closed });
      i = end;
    } else if (/\d/.test(ch) || (ch === '.' && next !== undefined && /\d/.test(next) && !/[\w`]/.test(sql[i - 1] ?? ''))) {
      const m = /^(0x[0-9a-f]+|\d*\.?\d+(?:e[+-]?\d+)?)/i.exec(sql.slice(i))!;
      push('number', i, i + m[0].length);
      i += m[0].length;
    } else if (WORD_START.test(ch)) {
      let j = i + 1;
      while (j < sql.length && WORD_CHAR.test(sql[j])) j++;
      push('word', i, j);
      i = j;
    } else if (ch === '(') {
      push('punct', i, i + 1);
      stack.push(tokens.length - 1);
      i++;
    } else if (ch === ')') {
      if (stack.length) stack.pop();
      push('punct', i, i + 1);
      // A ")" belongs to the group it closes, at the outer depth.
      i++;
    } else if (ch === ',' || ch === ';' || ch === '.') {
      push('punct', i, i + 1);
      i++;
    } else {
      const op = OPS.find((o) => sql.startsWith(o, i)) ?? ch;
      push('op', i, i + op.length);
      i += op.length;
    }
  }
  return tokens;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const isWord = (t: Token | undefined, ...values: string[]) => !!t && t.type === 'word' && (values.length === 0 || values.includes(t.value));
const nameOf = (t: Token) => (t.type === 'ident' ? t.value : t.text);
const isName = (t: Token | undefined) => !!t && (t.type === 'ident' || (t.type === 'word' && !t.text.startsWith('@')));

/** Words that end a table reference / can never be an alias. */
const NOT_ALIAS = new Set([
  'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'ON', 'USING', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL',
  'STRAIGHT_JOIN', 'OUTER', 'UNION', 'EXCEPT', 'INTERSECT', 'SET', 'WINDOW', 'FOR', 'LOCK', 'INTO', 'VALUES', 'SELECT',
  'PARTITION', 'USE', 'IGNORE', 'FORCE', 'AS', 'WITH', 'LATERAL', 'FROM', 'AND', 'OR', 'NOT', 'RETURNING', 'ROWS',
]);

const KEYWORDS_IN_SELECT_ITEM = new Set([
  'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AND', 'OR', 'NOT', 'IS', 'NULL', 'IN', 'LIKE', 'BETWEEN', 'INTERVAL', 'DIV',
  'MOD', 'XOR', 'REGEXP', 'RLIKE', 'COLLATE', 'BINARY', 'EXISTS', 'TRUE', 'FALSE', 'OVER', 'DISTINCT', 'SEPARATOR', 'ESCAPE',
  'UNKNOWN', 'SOUNDS', 'MEMBER', 'OF',
]);

const SELECT_MODIFIERS = new Set([
  'DISTINCT', 'ALL', 'DISTINCTROW', 'HIGH_PRIORITY', 'STRAIGHT_JOIN', 'SQL_CALC_FOUND_ROWS', 'SQL_NO_CACHE', 'SQL_CACHE',
  'SQL_SMALL_RESULT', 'SQL_BIG_RESULT', 'SQL_BUFFER_RESULT',
]);

/** Reserved words people commonly use as table or column names. */
export const RESERVED = new Set([
  'ACCESSIBLE', 'ADD', 'ALL', 'ALTER', 'ANALYZE', 'AND', 'AS', 'ASC', 'BEFORE', 'BETWEEN', 'BY', 'CALL', 'CASCADE', 'CASE',
  'CHANGE', 'CHECK', 'COLLATE', 'COLUMN', 'CONDITION', 'CONSTRAINT', 'CREATE', 'CROSS', 'CUME_DIST', 'CURRENT_DATE',
  'CURRENT_TIME', 'CURRENT_USER', 'DATABASE', 'DEFAULT', 'DELETE', 'DENSE_RANK', 'DESC', 'DESCRIBE', 'DISTINCT', 'DIV',
  'DROP', 'DUAL', 'EACH', 'ELSE', 'EMPTY', 'EXISTS', 'EXPLAIN', 'FALSE', 'FETCH', 'FIRST_VALUE', 'FOR', 'FORCE', 'FOREIGN',
  'FROM', 'FUNCTION', 'GRANT', 'GROUP', 'GROUPS', 'HAVING', 'IF', 'IGNORE', 'IN', 'INDEX', 'INSERT', 'INTERVAL', 'INTO', 'IS',
  'JOIN', 'KEY', 'KEYS', 'KILL', 'LAG', 'LAST_VALUE', 'LEAD', 'LEAVE', 'LEFT', 'LIKE', 'LIMIT', 'LINES', 'LOAD', 'LOCK',
  'MATCH', 'MOD', 'NATURAL', 'NOT', 'NTH_VALUE', 'NTILE', 'NULL', 'OF', 'ON', 'OPTION', 'OR', 'ORDER', 'OUT', 'OUTER', 'OVER',
  'PARTITION', 'PERCENT_RANK', 'PRIMARY', 'RANGE', 'RANK', 'READ', 'RECURSIVE', 'REFERENCES', 'RELEASE', 'RENAME', 'REPEAT',
  'REPLACE', 'REQUIRE', 'RETURN', 'REVOKE', 'RIGHT', 'ROW', 'ROW_NUMBER', 'ROWS', 'SCHEMA', 'SELECT', 'SET', 'SHOW', 'SIGNAL',
  'SYSTEM', 'TABLE', 'THEN', 'TO', 'TRIGGER', 'TRUE', 'UNION', 'UNIQUE', 'UPDATE', 'USAGE', 'USE', 'USING', 'VALUES', 'WHEN',
  'WHERE', 'WINDOW', 'WITH', 'WRITE',
]);

/** Clause keywords and their position in each statement type. */
const CLAUSE_RANK: Record<string, Record<string, number>> = {
  SELECT: { FROM: 1, WHERE: 2, 'GROUP BY': 3, HAVING: 4, WINDOW: 5, 'ORDER BY': 6, LIMIT: 7, FOR: 8, LOCK: 8 },
  UPDATE: { SET: 1, WHERE: 2, 'ORDER BY': 3, LIMIT: 4 },
  DELETE: { FROM: 1, USING: 2, WHERE: 3, 'ORDER BY': 4, LIMIT: 5 },
};

interface Clause {
  name: string;
  /** Token index of the keyword. */
  start: number;
  /** Offsets of the whole clause (keyword to before the next clause). */
  from: number;
  to: number;
}

/** Direct children (same depth) of a group, -1 = top level. */
function children(tokens: Token[], group: number): number[] {
  const out: number[] = [];
  tokens.forEach((t, i) => {
    if (t.group === group && !(t.type === 'punct' && t.text === ')' && t.depth === tokens[group]?.depth)) out.push(i);
  });
  return out;
}

/** Index of the ")" that closes the "(" at `open`, or -1. */
function closing(tokens: Token[], open: number): number {
  const depth = tokens[open].depth;
  for (let i = open + 1; i < tokens.length; i++) if (tokens[i].text === ')' && tokens[i].type === 'punct' && tokens[i].depth === depth) return i;
  return -1;
}

/**
 * Split a group's direct tokens into query segments (UNION / EXCEPT /
 * INTERSECT) and find clause keywords in each one.
 */
function segments(tokens: Token[], group: number, textEnd: number): { verb: string; verbAt: number; clauses: Clause[]; end: number }[] {
  const ids = children(tokens, group);
  const out: { verb: string; verbAt: number; clauses: Clause[]; end: number }[] = [];
  let current: { verb: string; verbAt: number; clauses: Clause[]; end: number } | null = null;
  const groupEnd = group === -1 ? textEnd : tokens[closing(tokens, group)]?.from ?? textEnd;

  const close = (end: number) => {
    if (!current) return;
    current.end = end;
    const c = current.clauses;
    for (let k = 0; k < c.length; k++) c[k].to = k + 1 < c.length ? c[k + 1].from : end;
    out.push(current);
    current = null;
  };

  for (let n = 0; n < ids.length; n++) {
    const i = ids[n];
    const t = tokens[i];
    if (t.type !== 'word') continue;
    if (['UNION', 'EXCEPT', 'INTERSECT'].includes(t.value)) {
      close(t.from);
      continue;
    }
    if (!current) {
      if (['SELECT', 'UPDATE', 'DELETE'].includes(t.value)) current = { verb: t.value, verbAt: i, clauses: [], end: groupEnd };
      continue;
    }
    // "ON DUPLICATE KEY UPDATE" and INSERT ... SELECT are out of scope.
    const nextWord = tokens[ids[n + 1]];
    let name = '';
    if ((t.value === 'GROUP' || t.value === 'ORDER') && isWord(nextWord, 'BY')) name = `${t.value} BY`;
    else if (['FROM', 'WHERE', 'HAVING', 'LIMIT', 'WINDOW', 'SET', 'USING'].includes(t.value)) name = t.value;
    else if (t.value === 'FOR' && isWord(nextWord, 'UPDATE', 'SHARE')) name = 'FOR';
    else if (t.value === 'LOCK' && isWord(nextWord, 'IN')) name = 'LOCK';
    if (!name || CLAUSE_RANK[current.verb][name] === undefined) continue;
    current.clauses.push({ name, start: i, from: t.from, to: t.to });
  }
  close(groupEnd);
  return out;
}

/** All groups that start a query: the top level and every "(SELECT ...". */
function queryGroups(tokens: Token[]): number[] {
  const groups = [-1];
  tokens.forEach((t, i) => {
    if (t.type === 'punct' && t.text === '(' && isWord(tokens[i + 1], 'SELECT', 'WITH')) groups.push(i);
  });
  return groups;
}

// --------------------------------------------------------------------------
// Rules
// --------------------------------------------------------------------------

function clauseOrder(sql: string, tokens: Token[], out: RuleDiagnostic[]) {
  for (const group of queryGroups(tokens)) {
    for (const seg of segments(tokens, group, sql.length)) {
      const ranks = CLAUSE_RANK[seg.verb];
      const seen = new Map<string, Clause>();
      let reported = false;
      for (const c of seg.clauses) {
        const prev = seen.get(c.name);
        if (prev) {
          out.push({
            rule: 'clause-twice',
            severity: 'error',
            from: c.from,
            to: c.name.includes(' ') ? tokens[c.start + 1].to : tokens[c.start].to,
            key: 'rules.clauseTwice',
            params: { clause: c.name },
            fixes: [],
          });
          reported = true;
        }
        seen.set(c.name, c);
      }
      if (reported) continue;
      // First clause that appears before one it should follow.
      for (let a = 0; a < seg.clauses.length; a++) {
        const later = seg.clauses.slice(a + 1).find((b) => ranks[b.name] < ranks[seg.clauses[a].name]);
        if (!later) continue;
        const misplaced = seg.clauses[a];
        const first = seg.clauses[0];
        const last = seg.clauses[seg.clauses.length - 1];
        const sorted = [...seg.clauses].sort((x, y) => ranks[x.name] - ranks[y.name]);
        const block = sql.slice(first.from, last.to);
        const joiner = /\n/.test(block) ? '\n' : ' ';
        const rebuilt = sorted.map((c) => sql.slice(c.from, c.to).trim()).join(joiner);
        const trailing = sql.slice(first.from, last.to).match(/\s*$/)?.[0] ?? '';
        out.push({
          rule: 'clause-order',
          severity: 'error',
          from: misplaced.from,
          to: misplaced.from + sql.slice(misplaced.from, misplaced.to).trimEnd().length,
          key: 'rules.clauseOrder',
          params: { clause: misplaced.name, after: later.name },
          fixes: [{ key: 'rules.fix.reorder', changes: [{ from: first.from, to: last.to, insert: rebuilt + trailing }] }],
        });
        break;
      }
    }
  }
}

const LIST_END = new Set(['FROM', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'INTO', 'UNION', 'WINDOW', 'ON', 'SET']);

function commas(sql: string, tokens: Token[], out: RuleDiagnostic[]) {
  tokens.forEach((t, i) => {
    if (t.text !== ',' || t.type !== 'punct') return;
    const next = tokens[i + 1];
    const prev = tokens[i - 1];
    const endsList =
      next?.type === 'word' && LIST_END.has(next.value) && next.depth === t.depth && (!['ORDER', 'GROUP'].includes(next.value) || isWord(tokens[i + 2], 'BY'));
    const trailing = !next || (next.type === 'punct' && (next.text === ')' || next.text === ';')) || endsList;
    const leading = !prev || (prev.type === 'punct' && (prev.text === '(' || prev.text === ',')) || isWord(prev, 'SELECT', 'BY', 'SET', 'VALUES');
    if (trailing || leading) {
      const before = next && next.type === 'word' ? next.value : next?.text ?? '';
      out.push({
        rule: 'extra-comma',
        severity: 'error',
        from: t.from,
        to: t.to,
        key: endsList ? 'rules.extraCommaBefore' : 'rules.extraComma',
        params: { word: before },
        fixes: [{ key: 'rules.fix.removeComma', changes: [{ from: t.from, to: t.to, insert: '' }] }],
      });
    }
  });
}

/** Select-list items without operators where names follow each other: "SELECT id name email". */
function missingCommas(sql: string, tokens: Token[], schema: SchemaMap, tables: string[], out: RuleDiagnostic[]) {
  const known = new Set(tables.flatMap((tb) => schema[tb]?.columns.map((c) => c.name.toLowerCase()) ?? []));
  tokens.forEach((t, i) => {
    if (!isWord(t, 'SELECT')) return;
    // Walk the select list at this depth.
    let j = i + 1;
    while (isWord(tokens[j]) && SELECT_MODIFIERS.has(tokens[j].value)) j++;
    let item: number[] = [];
    const flush = () => {
      checkItem(item);
      item = [];
    };
    for (; j < tokens.length; j++) {
      const k = tokens[j];
      if (k.depth < t.depth) break;
      if (k.depth > t.depth) {
        item.push(j);
        continue;
      }
      if (k.type === 'punct' && k.text === ',') flush();
      else if ((k.type === 'word' && LIST_END.has(k.value)) || (k.type === 'punct' && (k.text === ';' || k.text === ')'))) break;
      else item.push(j);
    }
    flush();
  });

  function checkItem(ids: number[]) {
    if (ids.length < 2) return;
    const top = ids.filter((id) => tokens[id].depth === tokens[ids[0]].depth);
    // Group into atoms: qualified names (a.b.c), calls f(...), literals.
    const atoms: { from: number; to: number; name: boolean; dotted: boolean; text: string }[] = [];
    for (let n = 0; n < top.length; n++) {
      const tk = tokens[top[n]];
      if (tk.type === 'op' || (tk.type === 'word' && KEYWORDS_IN_SELECT_ITEM.has(tk.value))) return; // an expression: not our case
      if (tk.type === 'punct' && tk.text === '.') {
        const last = atoms[atoms.length - 1];
        const nxt = tokens[top[n + 1]];
        if (last && nxt && (isName(nxt) || nxt.text === '*')) {
          last.to = nxt.to;
          last.dotted = true;
          last.text = sql.slice(last.from, last.to);
          n++;
          continue;
        }
        return;
      }
      if (tk.type === 'punct' && tk.text === '(') {
        // Function call or subquery: fold it into the previous atom (or a new one).
        const end = closing(tokens, top[n]);
        const close = end === -1 ? tokens[tokens.length - 1] : tokens[end];
        const last = atoms[atoms.length - 1];
        if (last && last.to === tk.from) {
          last.to = close.to;
          last.name = false;
        } else atoms.push({ from: tk.from, to: close.to, name: false, dotted: false, text: '' });
        while (n + 1 < top.length && tokens[top[n + 1]].from < close.to) n++;
        continue;
      }
      atoms.push({ from: tk.from, to: tk.to, name: isName(tk), dotted: false, text: tk.text });
    }
    if (atoms.length < 2) return;
    const names = atoms.filter((a) => a.name || a.dotted);
    const fixFor = (cut: typeof atoms) => cut.slice(0, -1).map((a) => ({ from: a.to, to: a.to, insert: ',' }));
    if (atoms.length >= 3 && names.length >= atoms.length - 1) {
      out.push({
        rule: 'missing-comma',
        severity: 'error',
        from: atoms[0].from,
        to: atoms[atoms.length - 1].to,
        key: 'rules.missingComma',
        params: { a: sql.slice(atoms[0].from, atoms[0].to), b: sql.slice(atoms[1].from, atoms[1].to) },
        fixes: [{ key: 'rules.fix.addCommas', changes: fixFor(atoms) }],
      });
    } else if (atoms.length === 2 && (atoms[1].dotted || (atoms[1].name && atoms[0].name && known.has(atoms[0].text.toLowerCase()) && known.has(atoms[1].text.toLowerCase())))) {
      // "s.id s.name" can't be an alias (dots); "id name" when both are columns is very likely a typo.
      out.push({
        rule: 'missing-comma',
        severity: atoms[1].dotted ? 'error' : 'warning',
        from: atoms[0].from,
        to: atoms[1].to,
        key: 'rules.missingComma',
        params: { a: sql.slice(atoms[0].from, atoms[0].to), b: sql.slice(atoms[1].from, atoms[1].to) },
        fixes: [{ key: 'rules.fix.addCommas', changes: fixFor(atoms) }],
      });
    }
  }
}

function parensAndQuotes(sql: string, tokens: Token[], out: RuleDiagnostic[]) {
  const open: Token[] = [];
  for (const t of tokens) {
    if (t.unterminated) {
      const eol = sql.indexOf('\n', t.from);
      out.push({
        rule: 'unclosed-quote',
        severity: 'error',
        from: t.from,
        to: eol === -1 ? sql.length : eol,
        key: 'rules.unclosedQuote',
        params: { quote: t.quote ?? "'" },
        fixes: [],
      });
      return; // everything after is inside the string
    }
    if (t.type !== 'punct') continue;
    if (t.text === '(') open.push(t);
    else if (t.text === ')') {
      if (open.length) open.pop();
      else
        out.push({
          rule: 'extra-paren',
          severity: 'error',
          from: t.from,
          to: t.to,
          key: 'rules.extraParen',
          params: {},
          fixes: [{ key: 'rules.fix.removeParen', changes: [{ from: t.from, to: t.to, insert: '' }] }],
        });
    }
  }
  for (const t of open) {
    out.push({
      rule: 'unclosed-paren',
      severity: 'error',
      from: t.from,
      to: t.to,
      key: 'rules.unclosedParen',
      params: {},
      fixes: open.length === 1 ? [{ key: 'rules.fix.closeParen', changes: [{ from: sql.trimEnd().length, to: sql.trimEnd().length, insert: ')' }] }] : [],
    });
  }
}

interface Scope {
  /** lowercased name -> token where it was defined */
  names: Map<string, Token>;
  /** Tables (real names) referenced in FROM/JOIN/UPDATE. */
  tables: { name: string; alias: Token | null; nameTok: Token }[];
}

/** Table names and aliases defined anywhere in the statement, per group for duplicates. */
function scopes(tokens: Token[], out: RuleDiagnostic[]): { all: Map<string, Token>; tables: Scope['tables']; consumed: Set<number> } {
  const all = new Map<string, Token>();
  const tables: Scope['tables'] = [];
  const consumed = new Set<number>();
  const perGroup = new Map<number, Map<string, Token>>();

  const define = (tok: Token, group: number) => {
    const key = nameOf(tok).toLowerCase();
    let g = perGroup.get(group);
    if (!g) perGroup.set(group, (g = new Map()));
    if (g.has(key)) {
      out.push({ rule: 'duplicate-alias', severity: 'error', from: tok.from, to: tok.to, key: 'rules.duplicateAlias', params: { alias: nameOf(tok) }, fixes: [] });
    }
    g.set(key, tok);
    all.set(key, tok);
  };

  // CTE names: WITH [RECURSIVE] name [(cols)] AS ( ... ) [, name AS ( ... )]
  tokens.forEach((t, i) => {
    if (!isWord(t, 'WITH')) return;
    let j = i + 1;
    if (isWord(tokens[j], 'RECURSIVE')) j++;
    while (isName(tokens[j])) {
      all.set(nameOf(tokens[j]).toLowerCase(), tokens[j]);
      consumed.add(j);
      j++;
      if (tokens[j]?.text === '(' && !isWord(tokens[j + 1], 'SELECT')) j = closing(tokens, j) + 1;
      if (!isWord(tokens[j], 'AS') || tokens[j + 1]?.text !== '(') break;
      j = closing(tokens, j + 1) + 1;
      if (tokens[j]?.text !== ',') break;
      j++;
    }
  });

  // Table references after FROM, JOIN, UPDATE, and commas inside a FROM list.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const startsRef = isWord(t, 'FROM', 'JOIN', 'STRAIGHT_JOIN') || (isWord(t, 'UPDATE') && !isWord(tokens[i - 1], 'KEY', 'FOR'));
    if (!startsRef) continue;
    // DELETE t1 FROM ... : the names before FROM are references, not definitions.
    let j = i + 1;
    let inFromList = true;
    while (inFromList && j < tokens.length) {
      while (isWord(tokens[j], 'LOW_PRIORITY', 'IGNORE', 'ONLY', 'LATERAL')) j++;
      const ref = tokens[j];
      if (!ref) break;
      let aliasAt = -1;
      if (ref.type === 'punct' && ref.text === '(' && tokens[j + 1] && !isWord(tokens[j + 1], 'SELECT', 'WITH', 'VALUES', 'TABLE') && tokens[j + 1].text !== '(') {
        // "( t1 a JOIN t2 b ON ... )": a parenthesized join (MariaDB writes view
        // bodies this way), not a derived table: read the references inside.
        j++;
        continue;
      }
      if (ref.type === 'punct' && ref.text === '(') {
        j = closing(tokens, j);
        if (j === -1) break;
        aliasAt = j + 1;
      } else if (isName(ref) && !(ref.type === 'word' && NOT_ALIAS.has(ref.value))) {
        let nameTok = ref;
        consumed.add(j);
        // db.table
        if (tokens[j + 1]?.text === '.' && isName(tokens[j + 2])) {
          consumed.add(j + 1);
          consumed.add(j + 2);
          nameTok = tokens[j + 2];
          j += 2;
        }
        // Table functions like JSON_TABLE(...)
        if (tokens[j + 1]?.text === '(' && tokens[j + 1].from === tokens[j].to) j = closing(tokens, j + 1);
        aliasAt = j + 1;
        const alias = (() => {
          let a = aliasAt;
          if (isWord(tokens[a], 'AS')) a++;
          const tk = tokens[a];
          if (tk && isName(tk) && !(tk.type === 'word' && NOT_ALIAS.has(tk.value))) {
            consumed.add(a);
            aliasAt = a + 1;
            return tk;
          }
          return null;
        })();
        tables.push({ name: nameOf(nameTok), alias, nameTok });
        define(alias ?? nameTok, t.group);
        j = aliasAt;
        // skip index hints: USE/FORCE/IGNORE INDEX (...)
        while (isWord(tokens[j], 'USE', 'FORCE', 'IGNORE') && isWord(tokens[j + 1], 'INDEX', 'KEY')) {
          j += 2;
          if (isWord(tokens[j], 'FOR')) j += 3;
          if (tokens[j]?.text === '(') j = closing(tokens, j) + 1;
        }
        if (tokens[j]?.text === ',' && isWord(t, 'FROM', 'UPDATE')) {
          j++;
          continue;
        }
        inFromList = false;
        continue;
      } else break;
      // Subquery / derived table alias
      let a = aliasAt;
      if (isWord(tokens[a], 'AS')) a++;
      if (tokens[a] && isName(tokens[a]) && !(tokens[a].type === 'word' && NOT_ALIAS.has(tokens[a].value))) {
        consumed.add(a);
        define(tokens[a], t.group);
        a++;
      }
      j = a;
      if (tokens[j]?.text === ',' && isWord(t, 'FROM', 'UPDATE')) {
        j++;
        continue;
      }
      inFromList = false;
    }
  }
  return { all, tables, consumed };
}

function aliases(sql: string, tokens: Token[], defined: Map<string, Token>, consumed: Set<number>, out: RuleDiagnostic[], tables: Scope['tables']) {
  const reported = new Set<string>();
  for (let i = 0; i + 2 < tokens.length; i++) {
    const q = tokens[i];
    if (consumed.has(i) || !isName(q) || tokens[i + 1].text !== '.' || tokens[i + 1].from !== q.to) continue;
    if (tokens[i - 1]?.text === '.' && tokens[i - 1].to === q.from) continue; // middle of a.b.c
    if (tokens[i + 3]?.text === '.' && tokens[i + 3].from === tokens[i + 2].to) continue; // db.table.column
    const col = tokens[i + 2];
    if (!(isName(col) || col.text === '*')) continue;
    if (q.type === 'word' && (RESERVED.has(q.value) || q.value === 'NEW' || q.value === 'OLD')) continue; // triggers: NEW.col
    const key = nameOf(q).toLowerCase();
    if (defined.has(key) || reported.has(key)) continue;
    reported.add(key);
    const names = [...defined.values()].map(nameOf);
    const suggestion = closest(nameOf(q), names);
    const fixes: RuleFix[] = [];
    if (suggestion) fixes.push({ key: 'rules.fix.useAlias', params: { alias: suggestion }, changes: [{ from: q.from, to: q.to, insert: suggestion }] });
    // One table without an alias: offer to give it this alias.
    const bare = tables.filter((tb) => !tb.alias);
    if (bare.length === 1 && tables.length === 1) {
      fixes.push({
        key: 'rules.fix.addAlias',
        params: { alias: nameOf(q), table: bare[0].name },
        changes: [{ from: bare[0].nameTok.to, to: bare[0].nameTok.to, insert: ' ' + nameOf(q) }],
      });
    }
    out.push({ rule: 'unknown-alias', severity: 'error', from: q.from, to: q.to, key: 'rules.unknownAlias', params: { alias: nameOf(q) }, fixes });
  }
}

function nullCompare(tokens: Token[], out: RuleDiagnostic[]) {
  tokens.forEach((t, i) => {
    if (t.type !== 'op' || !['=', '<>', '!='].includes(t.text)) return;
    const nul = tokens[i + 1];
    const before = tokens[i - 1];
    const isNull = (x: Token | undefined) => isWord(x, 'NULL');
    if (!isNull(nul) && !isNull(before)) return;
    // Assignments are fine: SET a = NULL, ON DUPLICATE KEY UPDATE a = NULL.
    for (let k = i - 1; k >= 0; k--) {
      const w = tokens[k];
      if (w.depth < t.depth) break;
      if (w.depth > t.depth || w.type !== 'word') continue;
      if (['SET', 'UPDATE'].includes(w.value)) return;
      if (['WHERE', 'ON', 'HAVING', 'WHEN', 'SELECT', 'AND', 'OR', 'IF'].includes(w.value)) break;
    }
    const op = t.text === '=' ? 'IS NULL' : 'IS NOT NULL';
    const from = isNull(nul) ? t.from : before.from;
    const to = isNull(nul) ? nul.to : t.to;
    const changes = isNull(nul) ? [{ from: t.from, to: nul.to, insert: op }] : [];
    out.push({
      rule: 'null-compare',
      severity: 'warning',
      from,
      to,
      key: 'rules.nullCompare',
      params: { op: t.text, fix: op },
      fixes: changes.length ? [{ key: 'rules.fix.useIsNull', params: { op }, changes }] : [],
    });
  });
}

function noWhere(tokens: Token[], out: RuleDiagnostic[]) {
  const top = tokens.filter((t) => t.depth === 0);
  const verb = top.find((t) => t.type === 'word');
  if (!verb || !['UPDATE', 'DELETE'].includes(verb.value)) return;
  if (top.some((t) => isWord(t, 'WHERE'))) return;
  out.push({ rule: 'no-where', severity: 'warning', from: verb.from, to: verb.to, key: verb.value === 'UPDATE' ? 'rules.noWhereUpdate' : 'rules.noWhereDelete', params: {}, fixes: [] });
}

const IDENT_BEFORE = new Set([',', '(', '=', '<', '>', '<=', '>=', '<>', '!=']);
const IDENT_BEFORE_WORDS = new Set(['SELECT', 'FROM', 'JOIN', 'INTO', 'UPDATE', 'BY', 'WHERE', 'AND', 'OR', 'ON', 'SET', 'TABLE', 'DISTINCT']);

function reservedWords(tokens: Token[], schema: SchemaMap, out: RuleDiagnostic[]) {
  const schemaNames = new Set<string>();
  for (const [tb, info] of Object.entries(schema)) {
    if (RESERVED.has(tb.toUpperCase())) schemaNames.add(tb.toUpperCase());
    for (const c of info.columns) if (RESERVED.has(c.name.toUpperCase())) schemaNames.add(c.name.toUpperCase());
  }
  // INSERT INTO t ( ...column list... ): every name there is an identifier.
  const insertCols = new Set<number>();
  tokens.forEach((t, i) => {
    if (!isWord(t, 'INTO') || !isWord(tokens[i - 1], 'INSERT', 'REPLACE', 'IGNORE')) return;
    let j = i + 1;
    if (tokens[j + 1]?.text === '.') j += 2;
    if (tokens[j + 1]?.text !== '(' || isWord(tokens[j + 2], 'SELECT')) return;
    const end = closing(tokens, j + 1);
    for (let k = j + 2; k < (end === -1 ? tokens.length : end); k++) insertCols.add(k);
  });
  tokens.forEach((t, i) => {
    if (t.type !== 'word' || !RESERVED.has(t.value)) return;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (prev?.text === '.' && prev.to === t.from) return; // s.order is fine in MySQL
    if (next?.text === '(' && next.from === t.to) return; // function call
    if (next?.text === '.' && next.from === t.to && !schemaNames.has(t.value)) return;
    const inInsert = insertCols.has(i);
    if (!inInsert) {
      if (!schemaNames.has(t.value)) return;
      if (isWord(next, 'BY')) return; // ORDER BY / GROUP BY keyword itself
      const slot = prev && ((prev.type !== 'word' && IDENT_BEFORE.has(prev.text)) || (prev.type === 'word' && IDENT_BEFORE_WORDS.has(prev.value)));
      if (!slot) return;
      // "SELECT DISTINCT x": DISTINCT is the modifier, not a column.
      if (t.value === 'DISTINCT' && isWord(prev, 'SELECT')) return;
    }
    out.push({
      rule: 'reserved-word',
      severity: 'error',
      from: t.from,
      to: t.to,
      key: 'rules.reservedWord',
      params: { word: t.text },
      fixes: [{ key: 'rules.fix.backticks', params: { word: t.text }, changes: [{ from: t.from, to: t.to, insert: '`' + t.text + '`' }] }],
    });
  });
}

function doubleQuotes(tokens: Token[], schema: SchemaMap, out: RuleDiagnostic[]) {
  const names = new Set<string>();
  for (const [tb, info] of Object.entries(schema)) {
    names.add(tb.toLowerCase());
    for (const c of info.columns) names.add(c.name.toLowerCase());
  }
  tokens.forEach((t, i) => {
    if (t.type !== 'string' || t.quote !== '"' || t.unterminated) return;
    const prev = tokens[i - 1];
    const afterTableWord = isWord(prev, 'FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE');
    if (isWord(prev, 'AS')) return; // SELECT x AS "Total" is a valid alias
    // Only where a column would go: "SELECT "name"", "WHERE "status" = 1" — not "type = "name"".
    const identSlot = !!prev && ((prev.type === 'word' && IDENT_BEFORE_WORDS.has(prev.value)) || prev.text === ',' || prev.text === '(');
    if (!afterTableWord && !(identSlot && names.has(t.value.toLowerCase()))) return;
    out.push({
      rule: 'double-quote-ident',
      severity: afterTableWord ? 'error' : 'warning',
      from: t.from,
      to: t.to,
      key: 'rules.doubleQuote',
      params: { name: t.value },
      fixes: [{ key: 'rules.fix.backticks', params: { word: t.value }, changes: [{ from: t.from, to: t.to, insert: '`' + t.value.replace(/`/g, '``') + '`' }] }],
    });
  });
}

// --------------------------------------------------------------------------
// Entry points
// --------------------------------------------------------------------------

export interface RuleContext {
  schema?: SchemaMap;
}

/** Diagnostics for one statement (offsets relative to `sql`). */
export function checkStatement(sql: string, ctx: RuleContext = {}): RuleDiagnostic[] {
  const schema = ctx.schema ?? {};
  const tokens = tokenize(sql);
  if (!tokens.length) return [];
  const out: RuleDiagnostic[] = [];

  parensAndQuotes(sql, tokens, out);
  // With broken quotes or parens the rest would only add noise.
  if (out.some((d) => d.rule === 'unclosed-quote')) return out;

  commas(sql, tokens, out);
  clauseOrder(sql, tokens, out);
  const { all, tables, consumed } = scopes(tokens, out);
  const tablesLower = new Map(Object.keys(schema).map((n) => [n.toLowerCase(), n]));
  const realTables = tables.map((tb) => tablesLower.get(tb.name.toLowerCase())).filter((x): x is string => !!x);
  missingCommas(sql, tokens, schema, realTables, out);
  aliases(sql, tokens, all, consumed, out, tables);
  nullCompare(tokens, out);
  noWhere(tokens, out);
  reservedWords(tokens, schema, out);
  doubleQuotes(tokens, schema, out);

  // One diagnostic per position: keep the first (rules run most-specific first).
  const seen = new Set<string>();
  return out
    .filter((d) => {
      const k = `${d.from}:${d.to}:${d.rule}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.from - b.from);
}

/** Tables in FROM / JOIN / UPDATE with their alias (for "ambiguous column" fixes). */
export function tableRefs(sql: string): { table: string; alias: string | null }[] {
  const tokens = tokenize(sql);
  return scopes(tokens, []).tables.map((tb) => ({ table: tb.name, alias: tb.alias ? nameOf(tb.alias) : null }));
}

/** Apply a fix to the text (changes must not overlap). */
export function applyFix(sql: string, fix: RuleFix): string {
  const changes = [...fix.changes].sort((a, b) => b.from - a.from);
  let out = sql;
  for (const c of changes) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

/**
 * Best rule that explains a server syntax error (1064) for the result
 * panel: prefer one at or before the server's "near" text.
 */
export function explainSyntaxError(sql: string, near: string, ctx: RuleContext = {}): RuleDiagnostic | null {
  const diags = checkStatement(sql, ctx).filter((d) => d.severity === 'error');
  if (!diags.length) return null;
  const at = near ? sql.indexOf(near.slice(0, 30)) : -1;
  if (at === -1) return diags[0];
  return diags.find((d) => d.from <= at + near.length && d.to >= at - 200) ?? diags[0];
}
