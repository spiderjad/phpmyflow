// SQL history and saved editor tabs live in localStorage. Statements that
// carry a password (CREATE / ALTER USER … IDENTIFIED BY, SET PASSWORD, GRANT …
// IDENTIFIED, CHANGE MASTER / REPLICATION SOURCE …_PASSWORD, CREATE SERVER …
// PASSWORD) are stored with the password replaced by '***'.
import { describe, expect, it } from 'vitest';
import { addRun, redactSecrets } from '../../web/src/lib/history';
import { TabStore } from '../../web/src/lib/tabs.svelte';

const SECRET = 'S3cr3t-pw';
const withSecrets = [
  `CREATE USER 'app'@'%' IDENTIFIED BY '${SECRET}'`,
  `ALTER USER app IDENTIFIED BY "${SECRET}" REPLACE '${SECRET}'`,
  `CREATE USER app IDENTIFIED WITH mysql_native_password BY '${SECRET}'`,
  `CREATE USER app IDENTIFIED VIA mysql_native_password USING PASSWORD('${SECRET}')`,
  `SET PASSWORD FOR 'app'@'%' = '${SECRET}'`,
  `SET PASSWORD = PASSWORD('${SECRET}')`,
  `GRANT ALL ON *.* TO app IDENTIFIED BY '${SECRET}'`,
  `CHANGE MASTER TO MASTER_HOST='h', MASTER_PASSWORD='${SECRET}'`,
  `CHANGE REPLICATION SOURCE TO SOURCE_PASSWORD = '${SECRET}'`,
  `CREATE SERVER s FOREIGN DATA WRAPPER mysql OPTIONS (USER 'u', PASSWORD '${SECRET}')`,
  `create user app identified by '${SECRET.replace('-', "''")}'`,
];

describe('passwords never reach localStorage', () => {
  it('redactSecrets hides every password', () => {
    for (const sql of withSecrets) {
      const out = redactSecrets(sql);
      expect(out, sql).not.toContain('S3cr3t');
      expect(out, sql).toContain("'***'");
    }
  });

  it('ordinary statements are unchanged', () => {
    for (const sql of [
      "SELECT 'x' AS a, 'by' AS b FROM t WHERE name = 'IDENTIFIED BY'",
      "UPDATE users SET password = 'hash' WHERE id = 1",
      "SELECT * FROM t ORDER BY 'a'",
    ]) {
      expect(redactSecrets(sql)).toBe(sql);
    }
  });

  it('history entries and saved tabs are stored without the password', () => {
    const list = addRun([], { sql: withSecrets[0], db: '', at: 1, ok: true });
    expect(JSON.stringify(list)).not.toContain(SECRET);

    const data: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => void (data[k] = v),
      removeItem: (k: string) => void delete data[k],
    } as unknown as Storage;
    const store = new TabStore(storage);
    store.load('pmf_tabs:t@h:1');
    store.create({ sql: withSecrets[4] });
    store.flush();
    expect(data['pmf_tabs:t@h:1']).toBeDefined();
    expect(data['pmf_tabs:t@h:1']).not.toContain(SECRET);
  });
});
