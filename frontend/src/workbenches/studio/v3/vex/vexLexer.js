// ArchDisc Studio V3 — real Houdini VEX-flavour tokenizer (slice 745).
//
// Distinct from the existing ASL lexer (./lexer.js — `pos.x`/`nor.x`
// shape, no attribute model). This one tokenises real VEX:
//   typed locals     float a; int i; vec3 v;
//   attribute reads  @P @N @Cd @id @pt @npt   (.x/.y/.z/.r/.g/.b)
//   vec3 literal     {x, y, z}
//   compound assign  += -= *= /=
//   relational       == != < <= > >=
//   logical          && || !
//   keywords         if else return
//   block braces     { }    (also vec3 literal)
//
// Pure JS, zero deps, no eval/new Function. Position-tracked so the
// interpreter can report `{line, col}` on a parse error.

export const TK = Object.freeze({
  NUMBER:   'NUMBER',
  IDENT:    'IDENT',
  KEYWORD:  'KEYWORD',
  ATTR:     'ATTR',          // @P @N @Cd @id @pt @npt
  TYPE:     'TYPE',          // float int vec3
  OP:       'OP',            // + - * / && || ! == != < > <= >=
  ASSIGN:   'ASSIGN',        // = += -= *= /=
  LPAREN:   'LPAREN',
  RPAREN:   'RPAREN',
  LBRACE:   'LBRACE',
  RBRACE:   'RBRACE',
  DOT:      'DOT',
  COMMA:    'COMMA',
  SEMI:     'SEMI',
  EOF:      'EOF',
});

const KEYWORDS = new Set(['if', 'else', 'return']);
const TYPES = new Set(['float', 'int', 'vec3']);
const ATTRS = new Set(['P', 'N', 'Cd', 'id', 'pt', 'npt']);

function isDigit(c) { return c >= '0' && c <= '9'; }
function isAlpha(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
function isAlnum(c) { return isAlpha(c) || isDigit(c); }

export function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const N = src.length;

  function push(kind, value, l, c) {
    tokens.push({ kind, value, line: l, col: c });
  }

  while (i < N) {
    const ch = src[i];

    // Whitespace / newline
    if (ch === '\n') { line++; col = 1; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { col++; i++; continue; }

    // Line comment //
    if (ch === '/' && src[i + 1] === '/') {
      while (i < N && src[i] !== '\n') { i++; col++; }
      continue;
    }
    // Block comment /* */
    if (ch === '/' && src[i + 1] === '*') {
      i += 2; col += 2;
      while (i < N && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') { line++; col = 1; } else { col++; }
        i++;
      }
      if (i < N) { i += 2; col += 2; }
      continue;
    }

    const startLine = line;
    const startCol = col;

    // Numbers (integer or float)
    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1]))) {
      let s = '';
      while (i < N && (isDigit(src[i]) || src[i] === '.')) {
        s += src[i]; i++; col++;
      }
      // Exponent
      if (i < N && (src[i] === 'e' || src[i] === 'E')) {
        s += src[i]; i++; col++;
        if (i < N && (src[i] === '+' || src[i] === '-')) {
          s += src[i]; i++; col++;
        }
        while (i < N && isDigit(src[i])) { s += src[i]; i++; col++; }
      }
      push(TK.NUMBER, Number(s), startLine, startCol);
      continue;
    }

    // Attribute @P / @N / @Cd / @id / @pt / @npt
    if (ch === '@') {
      i++; col++;
      let s = '';
      while (i < N && isAlnum(src[i])) { s += src[i]; i++; col++; }
      if (!ATTRS.has(s)) {
        throw new VexParseError(
          `Unknown attribute @${s} (expected @P @N @Cd @id @pt @npt)`,
          startLine, startCol,
        );
      }
      push(TK.ATTR, s, startLine, startCol);
      continue;
    }

    // Identifier / keyword / type
    if (isAlpha(ch)) {
      let s = '';
      while (i < N && isAlnum(src[i])) { s += src[i]; i++; col++; }
      if (TYPES.has(s)) push(TK.TYPE, s, startLine, startCol);
      else if (KEYWORDS.has(s)) push(TK.KEYWORD, s, startLine, startCol);
      else push(TK.IDENT, s, startLine, startCol);
      continue;
    }

    // Compound operators
    if (ch === '=' && src[i + 1] === '=') { push(TK.OP, '==', startLine, startCol); i += 2; col += 2; continue; }
    if (ch === '!' && src[i + 1] === '=') { push(TK.OP, '!=', startLine, startCol); i += 2; col += 2; continue; }
    if (ch === '<' && src[i + 1] === '=') { push(TK.OP, '<=', startLine, startCol); i += 2; col += 2; continue; }
    if (ch === '>' && src[i + 1] === '=') { push(TK.OP, '>=', startLine, startCol); i += 2; col += 2; continue; }
    if (ch === '&' && src[i + 1] === '&') { push(TK.OP, '&&', startLine, startCol); i += 2; col += 2; continue; }
    if (ch === '|' && src[i + 1] === '|') { push(TK.OP, '||', startLine, startCol); i += 2; col += 2; continue; }
    if (ch === '+' && src[i + 1] === '=') { push(TK.ASSIGN, '+=', startLine, startCol); i += 2; col += 2; continue; }
    if (ch === '-' && src[i + 1] === '=') { push(TK.ASSIGN, '-=', startLine, startCol); i += 2; col += 2; continue; }
    if (ch === '*' && src[i + 1] === '=') { push(TK.ASSIGN, '*=', startLine, startCol); i += 2; col += 2; continue; }
    if (ch === '/' && src[i + 1] === '=') { push(TK.ASSIGN, '/=', startLine, startCol); i += 2; col += 2; continue; }

    // Single char tokens
    switch (ch) {
      case '+': case '-': case '*': case '/':
        push(TK.OP, ch, startLine, startCol); i++; col++; continue;
      case '<': case '>': case '!':
        push(TK.OP, ch, startLine, startCol); i++; col++; continue;
      case '=':
        push(TK.ASSIGN, '=', startLine, startCol); i++; col++; continue;
      case '(': push(TK.LPAREN, '(', startLine, startCol); i++; col++; continue;
      case ')': push(TK.RPAREN, ')', startLine, startCol); i++; col++; continue;
      case '{': push(TK.LBRACE, '{', startLine, startCol); i++; col++; continue;
      case '}': push(TK.RBRACE, '}', startLine, startCol); i++; col++; continue;
      case '.': push(TK.DOT, '.', startLine, startCol); i++; col++; continue;
      case ',': push(TK.COMMA, ',', startLine, startCol); i++; col++; continue;
      case ';': push(TK.SEMI, ';', startLine, startCol); i++; col++; continue;
      default:
        throw new VexParseError(
          `Unexpected character '${ch}'`, startLine, startCol,
        );
    }
  }

  push(TK.EOF, null, line, col);
  return tokens;
}

export class VexParseError extends Error {
  constructor(msg, line, col) {
    super(`${msg} (line ${line}, col ${col})`);
    this.name = 'VexParseError';
    this.line = line;
    this.col = col;
  }
}
