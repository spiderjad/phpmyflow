// Our own copy (src/i18n/*.ts) with `code` in backticks → safe HTML.
const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const rich = (s: string): string => escape(s).replace(/`([^`]+)`/g, '<code>$1</code>');
