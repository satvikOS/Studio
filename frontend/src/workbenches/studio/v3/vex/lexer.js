// ArchDisc Studio V3 — ASL (ArchDisc Scripting Language) tokeniser.
//
// Tokenises a per-vertex script into a flat list. The parser
// (parser.js) walks the resulting tokens via a one-token-lookahead
// recursive-descent grammar. The interpreter (interpreter.js) then
// evaluates the AST per vertex.
//
// We deliberately keep the lexer dependency-free + pure native — no
// regex engines pulled in, no helper libs. Just a character cursor
// and a small token kind table.
//
// Token kinds emitted:
//   NUMBER   numeric literal           value = Number
//   IDENT    identifier or keyword     value = string
//   OP       arithmetic operator       value = '+'|'-'|'*'|'/'
//   ASSIGN   '='                       value = '='
//   LPAREN   '('
//   RPAREN   ')'
//   DOT      '.'
//   COMMA    ','
//   SEMI     ';'
//   IF       reserved word 'if'        value = 'if'
//   EOF      end of input
//
// Comparison operators (== != < > <= >=) are recognised as OP with the
// concrete symbol as the value, so the parser can fold them into a
// generic binary-op rule.
//
// We track (line, col) on every token so the interpreter can surface
// helpful error positions back into the React Editor.jsx surface.

const RESERVED = Object.freeze({ if: 'IF' });

function isDigit(c)  { return c >= '0' && c <= '9'; }
function isAlpha(c)  { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
function isAlnum(c)  { return isAlpha(c) || isDigit(c); }
function isWhite(c)  { return c === ' ' || c === '\t' || c === '\r' || c === '\n'; }

/**
 * Tokenise an ASL source string.
 * @param {string} src
 * @returns {{ ok: boolean, tokens?: Array, error?: string, line?: number, col?: number }}
 */
export function tokenize(src) {
  if (typeof src !== 'string') return { ok: false, error: 'source not a string', line: 1, col: 1 };
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const N = src.length;

  const advance = (n) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') { line += 1; col = 1; }
      else { col += 1; }
      i += 1;
    }
  };

  while (i < N) {
    const c = src[i];

    // ── whitespace ──
    if (isWhite(c)) { advance(1); continue; }

    // ── comments: // … to end-of-line ──
    if (c === '/' && src[i + 1] === '/') {
      while (i < N && src[i] !== '\n') advance(1);
      continue;
    }

    // ── numbers ──
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      const startLine = line, startCol = col;
      let s = '';
      while (i < N && (isDigit(src[i]) || src[i] === '.')) {
        s += src[i]; advance(1);
      }
      // Optional scientific notation: 1e3, 2.5e-4
      if (i < N && (src[i] === 'e' || src[i] === 'E')) {
        s += src[i]; advance(1);
        if (i < N && (src[i] === '+' || src[i] === '-')) { s += src[i]; advance(1); }
        while (i < N && isDigit(src[i])) { s += src[i]; advance(1); }
      }
      const v = Number(s);
      if (!isFinite(v)) {
        return { ok: false, error: `bad number "${s}"`, line: startLine, col: startCol };
      }
      tokens.push({ kind: 'NUMBER', value: v, line: startLine, col: startCol });
      continue;
    }

    // ── identifiers / keywords ──
    if (isAlpha(c)) {
      const startLine = line, startCol = col;
      let s = '';
      while (i < N && isAlnum(src[i])) { s += src[i]; advance(1); }
      const kind = RESERVED[s] || 'IDENT';
      tokens.push({ kind, value: s, line: startLine, col: startCol });
      continue;
    }

    // ── two-char ops: ==, !=, <=, >= ──
    if (c === '=' && src[i + 1] === '=') {
      tokens.push({ kind: 'OP', value: '==', line, col }); advance(2); continue;
    }
    if (c === '!' && src[i + 1] === '=') {
      tokens.push({ kind: 'OP', value: '!=', line, col }); advance(2); continue;
    }
    if (c === '<' && src[i + 1] === '=') {
      tokens.push({ kind: 'OP', value: '<=', line, col }); advance(2); continue;
    }
    if (c === '>' && src[i + 1] === '=') {
      tokens.push({ kind: 'OP', value: '>=', line, col }); advance(2); continue;
    }

    // ── single-char tokens ──
    if (c === '=') { tokens.push({ kind: 'ASSIGN', value: '=', line, col }); advance(1); continue; }
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '<' || c === '>') {
      tokens.push({ kind: 'OP', value: c, line, col }); advance(1); continue;
    }
    if (c === '(') { tokens.push({ kind: 'LPAREN', value: '(', line, col }); advance(1); continue; }
    if (c === ')') { tokens.push({ kind: 'RPAREN', value: ')', line, col }); advance(1); continue; }
    if (c === '.') { tokens.push({ kind: 'DOT',    value: '.', line, col }); advance(1); continue; }
    if (c === ',') { tokens.push({ kind: 'COMMA',  value: ',', line, col }); advance(1); continue; }
    if (c === ';') { tokens.push({ kind: 'SEMI',   value: ';', line, col }); advance(1); continue; }

    return { ok: false, error: `unexpected character "${c}"`, line, col };
  }

  tokens.push({ kind: 'EOF', value: null, line, col });
  return { ok: true, tokens };
}

export default tokenize;
