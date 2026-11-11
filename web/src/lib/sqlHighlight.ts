// SQL syntax colors from the theme variables (light and dark), shared by the
// SQL editor and the object body editor.
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export const sqlHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: 'var(--syn-keyword)', fontWeight: '500' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syn-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syn-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [tags.typeName, tags.standard(tags.name)], color: 'var(--syn-type)' },
  { tag: [tags.special(tags.name), tags.quote], color: 'var(--syn-ident)' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: 'var(--sp-text-secondary)' },
]);

export const sqlHighlight = () => syntaxHighlighting(sqlHighlightStyle);
