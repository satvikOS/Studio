// ArchDisc Studio V3 — real Houdini VEX-flavour parser (slice 745).
//
// Recursive-descent parser over the vexLexer token stream. Produces a
// small AST consumed by vexInterpreter.js. No deps, no eval.
//
// AST node shapes:
//   Block       { type, stmts: Node[] }
//   VarDecl     { type='VarDecl', varType, name, init? }
//   Assign      { type='Assign', target, op, expr }     // target: AttrRef|Ident|Member
//   AttrRef     { type='AttrRef', name }                // @P, @N, @Cd, @id, @pt, @npt
//   Member      { type='Member', object, comp }         // a.x, @P.y
//   Ident       { type='Ident', name }
//   If          { type='If', cond, then, else? }
//   Return      { type='Return', expr? }
//   ExprStmt    { type='ExprStmt', expr }
//   BinOp       { type='BinOp', op, l, r }
//   UnaryOp     { type='UnaryOp', op, x }
//   Call        { type='Call', name, args: Node[] }
//   Num         { type='Num', value: number }
//   Vec3Lit     { type='Vec3Lit', x, y, z }

import { TK, VexParseError } from './vexLexer.js';

const COMPS = new Set(['x', 'y', 'z', 'r', 'g', 'b']);

export function parse(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const peekKind = () => tokens[i].kind;
  const eat = (kind, expected) => {
    const t = tokens[i];
    if (t.kind !== kind) {
      throw new VexParseError(
        `Expected ${expected || kind}, got ${t.kind} '${t.value}'`,
        t.line, t.col,
      );
    }
    i++;
    return t;
  };
  const tryEat = (kind, value) => {
    const t = tokens[i];
    if (t.kind !== kind) return null;
    if (value != null && t.value !== value) return null;
    i++;
    return t;
  };

  function parseProgram() {
    const stmts = [];
    while (peekKind() !== TK.EOF) stmts.push(parseStmt());
    return { type: 'Block', stmts };
  }

  function parseStmt() {
    const t = peek();

    // Block { ... }
    if (t.kind === TK.LBRACE) {
      i++;
      const stmts = [];
      while (peekKind() !== TK.RBRACE && peekKind() !== TK.EOF) stmts.push(parseStmt());
      eat(TK.RBRACE, '}');
      return { type: 'Block', stmts };
    }
    // Type-declared local: float a = ...;
    if (t.kind === TK.TYPE) {
      i++;
      const name = eat(TK.IDENT, 'identifier').value;
      let init = null;
      if (tryEat(TK.ASSIGN, '=')) init = parseExpr();
      eat(TK.SEMI, ';');
      return { type: 'VarDecl', varType: t.value, name, init };
    }
    // if
    if (t.kind === TK.KEYWORD && t.value === 'if') {
      i++;
      eat(TK.LPAREN, '(');
      const cond = parseExpr();
      eat(TK.RPAREN, ')');
      const thenBranch = parseStmt();
      let elseBranch = null;
      if (peek().kind === TK.KEYWORD && peek().value === 'else') {
        i++;
        elseBranch = parseStmt();
      }
      return { type: 'If', cond, then: thenBranch, else: elseBranch };
    }
    // return
    if (t.kind === TK.KEYWORD && t.value === 'return') {
      i++;
      let expr = null;
      if (peekKind() !== TK.SEMI) expr = parseExpr();
      eat(TK.SEMI, ';');
      return { type: 'Return', expr };
    }

    // Try assignment OR expression statement.
    // We lookahead for an l-value followed by an ASSIGN token. The
    // structure of an l-value is limited: ATTR(.COMP)? | IDENT(.COMP)?
    const save = i;
    const lval = tryParseLValue();
    if (lval && peekKind() === TK.ASSIGN) {
      const op = eat(TK.ASSIGN).value;
      const expr = parseExpr();
      eat(TK.SEMI, ';');
      return { type: 'Assign', target: lval, op, expr };
    }
    // Roll back, parse as expression statement.
    i = save;
    const expr = parseExpr();
    eat(TK.SEMI, ';');
    return { type: 'ExprStmt', expr };
  }

  function tryParseLValue() {
    const t = peek();
    if (t.kind === TK.ATTR) {
      i++;
      let node = { type: 'AttrRef', name: t.value };
      if (tryEat(TK.DOT, '.')) {
        const ct = eat(TK.IDENT, 'component');
        if (!COMPS.has(ct.value)) {
          throw new VexParseError(`Bad swizzle .${ct.value}`, ct.line, ct.col);
        }
        node = { type: 'Member', object: node, comp: ct.value };
      }
      return node;
    }
    if (t.kind === TK.IDENT) {
      // Could be local var or function call; only allow plain Ident /
      // Member as l-value (not a call).
      if (tokens[i + 1] && tokens[i + 1].kind === TK.LPAREN) return null;
      i++;
      let node = { type: 'Ident', name: t.value };
      if (tryEat(TK.DOT, '.')) {
        const ct = eat(TK.IDENT, 'component');
        if (!COMPS.has(ct.value)) {
          throw new VexParseError(`Bad swizzle .${ct.value}`, ct.line, ct.col);
        }
        node = { type: 'Member', object: node, comp: ct.value };
      }
      return node;
    }
    return null;
  }

  // expr := logical
  function parseExpr() { return parseLogical(); }

  function parseLogical() {
    let l = parseEquality();
    while (peekKind() === TK.OP && (peek().value === '&&' || peek().value === '||')) {
      const op = tokens[i++].value;
      const r = parseEquality();
      l = { type: 'BinOp', op, l, r };
    }
    return l;
  }
  function parseEquality() {
    let l = parseRelational();
    while (peekKind() === TK.OP && (peek().value === '==' || peek().value === '!=')) {
      const op = tokens[i++].value;
      const r = parseRelational();
      l = { type: 'BinOp', op, l, r };
    }
    return l;
  }
  function parseRelational() {
    let l = parseAddSub();
    while (peekKind() === TK.OP &&
      (peek().value === '<' || peek().value === '<=' || peek().value === '>' || peek().value === '>=')) {
      const op = tokens[i++].value;
      const r = parseAddSub();
      l = { type: 'BinOp', op, l, r };
    }
    return l;
  }
  function parseAddSub() {
    let l = parseMulDiv();
    while (peekKind() === TK.OP && (peek().value === '+' || peek().value === '-')) {
      const op = tokens[i++].value;
      const r = parseMulDiv();
      l = { type: 'BinOp', op, l, r };
    }
    return l;
  }
  function parseMulDiv() {
    let l = parseUnary();
    while (peekKind() === TK.OP && (peek().value === '*' || peek().value === '/')) {
      const op = tokens[i++].value;
      const r = parseUnary();
      l = { type: 'BinOp', op, l, r };
    }
    return l;
  }
  function parseUnary() {
    if (peekKind() === TK.OP && (peek().value === '-' || peek().value === '+' || peek().value === '!')) {
      const op = tokens[i++].value;
      const x = parseUnary();
      return { type: 'UnaryOp', op, x };
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = peek();
    if (t.kind === TK.NUMBER) { i++; return { type: 'Num', value: t.value }; }
    if (t.kind === TK.ATTR) {
      i++;
      let node = { type: 'AttrRef', name: t.value };
      if (tryEat(TK.DOT, '.')) {
        const ct = eat(TK.IDENT, 'component');
        if (!COMPS.has(ct.value)) {
          throw new VexParseError(`Bad swizzle .${ct.value}`, ct.line, ct.col);
        }
        node = { type: 'Member', object: node, comp: ct.value };
      }
      return node;
    }
    if (t.kind === TK.LPAREN) {
      i++;
      const e = parseExpr();
      eat(TK.RPAREN, ')');
      return e;
    }
    if (t.kind === TK.LBRACE) {
      // vec3 literal { x, y, z }
      i++;
      const x = parseExpr();
      eat(TK.COMMA, ',');
      const y = parseExpr();
      eat(TK.COMMA, ',');
      const z = parseExpr();
      eat(TK.RBRACE, '}');
      return { type: 'Vec3Lit', x, y, z };
    }
    if (t.kind === TK.IDENT) {
      i++;
      // Function call?
      if (peek().kind === TK.LPAREN) {
        i++;
        const args = [];
        if (peek().kind !== TK.RPAREN) {
          args.push(parseExpr());
          while (peek().kind === TK.COMMA) { i++; args.push(parseExpr()); }
        }
        eat(TK.RPAREN, ')');
        return { type: 'Call', name: t.value, args };
      }
      // Ident, maybe with .swizzle
      let node = { type: 'Ident', name: t.value };
      if (tryEat(TK.DOT, '.')) {
        const ct = eat(TK.IDENT, 'component');
        if (!COMPS.has(ct.value)) {
          throw new VexParseError(`Bad swizzle .${ct.value}`, ct.line, ct.col);
        }
        node = { type: 'Member', object: node, comp: ct.value };
      }
      return node;
    }
    throw new VexParseError(
      `Unexpected token ${t.kind} '${t.value}'`,
      t.line, t.col,
    );
  }

  return parseProgram();
}
