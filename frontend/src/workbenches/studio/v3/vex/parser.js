// ArchDisc Studio V3 — ASL recursive-descent parser.
//
// Walks the token list produced by lexer.js and produces an AST. The
// grammar is intentionally tiny — no loops, no user-defined functions,
// no array indexing. Each top-level construct is a statement that
// either assigns to a name (or member access), evaluates a single-
// branch `if`, or evaluates an expression for its side-effect-free
// value.
//
// Grammar (one-token lookahead, all rules pure):
//
//   block      := { stmt }                       // sequence of statements
//   stmt       := if-stmt | assign-stmt | expr ';'
//   if-stmt    := IF '(' expr ')' stmt
//   assign-stmt:= lhs ASSIGN expr ';'            // lhs is IDENT or IDENT '.' IDENT
//   expr       := addExpr                        // + relational ops fold in
//   addExpr    := mulExpr { ('+'|'-') mulExpr }
//   mulExpr    := unary   { ('*'|'/') unary }
//   relExpr    := folded into addExpr (we treat <, <=, >, >=, ==, != as
//                 lowest-precedence binary ops above add — see code).
//   unary      := ['-'|'+'] primary
//   primary    := NUMBER
//              | IDENT                          // variable
//              | IDENT '.' IDENT                // member access
//              | IDENT '(' arglist? ')'         // function call
//              | '(' expr ')'                   // grouped expression
//              | '(' expr ',' expr ',' expr ')' // vec3 literal
//
// AST node shapes (the only shapes the interpreter ever consumes):
//
//   { type: 'Block',        body: Stmt[] }
//   { type: 'Assign',       target: { kind:'name'|'member', name, member? }, value: Expr }
//   { type: 'If',           cond: Expr, then: Stmt }
//   { type: 'ExprStmt',     expr: Expr }
//   { type: 'BinaryOp',     op: string, lhs: Expr, rhs: Expr }
//   { type: 'UnaryOp',      op: string, arg: Expr }
//   { type: 'Call',         name: string, args: Expr[] }
//   { type: 'MemberAccess', name: string, member: string }
//   { type: 'Number',       value: number }
//   { type: 'Variable',     name: string }
//   { type: 'Vec3',         x: Expr, y: Expr, z: Expr }
//
// Every node also gets a (line, col) for error reporting.

import { tokenize } from './lexer.js';

// Helper: relational/equality op test.
const REL = new Set(['<', '<=', '>', '>=', '==', '!=']);

class ParserState {
  constructor(tokens) {
    this.tokens = tokens;
    this.i = 0;
  }
  peek(o = 0) { return this.tokens[this.i + o]; }
  next() { return this.tokens[this.i++]; }
  match(kind, value) {
    const t = this.peek();
    if (t.kind !== kind) return null;
    if (value !== undefined && t.value !== value) return null;
    this.i += 1;
    return t;
  }
  expect(kind, value) {
    const t = this.peek();
    if (t.kind !== kind || (value !== undefined && t.value !== value)) {
      const want = value !== undefined ? `${kind}('${value}')` : kind;
      const got  = `${t.kind}${t.value != null ? `('${t.value}')` : ''}`;
      throw new ParseError(`expected ${want}, got ${got}`, t.line, t.col);
    }
    this.i += 1;
    return t;
  }
}

class ParseError extends Error {
  constructor(msg, line, col) {
    super(msg);
    this.name = 'ParseError';
    this.line = line || 1;
    this.col = col || 1;
  }
}

// ── Expression parsing ───────────────────────────────────────────────
//
// Precedence ladder (lowest first):
//   relational  <  <=  >  >=  ==  !=
//   additive    +  -
//   multiply    *  /
//   unary       prefix - +
//   primary     literals, variables, calls, member-access, groups

function parseExpr(p)      { return parseRel(p); }

function parseRel(p) {
  let lhs = parseAdd(p);
  while (p.peek().kind === 'OP' && REL.has(p.peek().value)) {
    const op = p.next();
    const rhs = parseAdd(p);
    lhs = { type: 'BinaryOp', op: op.value, lhs, rhs, line: op.line, col: op.col };
  }
  return lhs;
}

function parseAdd(p) {
  let lhs = parseMul(p);
  while (p.peek().kind === 'OP' && (p.peek().value === '+' || p.peek().value === '-')) {
    const op = p.next();
    const rhs = parseMul(p);
    lhs = { type: 'BinaryOp', op: op.value, lhs, rhs, line: op.line, col: op.col };
  }
  return lhs;
}

function parseMul(p) {
  let lhs = parseUnary(p);
  while (p.peek().kind === 'OP' && (p.peek().value === '*' || p.peek().value === '/')) {
    const op = p.next();
    const rhs = parseUnary(p);
    lhs = { type: 'BinaryOp', op: op.value, lhs, rhs, line: op.line, col: op.col };
  }
  return lhs;
}

function parseUnary(p) {
  const t = p.peek();
  if (t.kind === 'OP' && (t.value === '-' || t.value === '+')) {
    const op = p.next();
    const arg = parseUnary(p);
    return { type: 'UnaryOp', op: op.value, arg, line: op.line, col: op.col };
  }
  return parsePrimary(p);
}

function parsePrimary(p) {
  const t = p.peek();

  // Numeric literal.
  if (t.kind === 'NUMBER') {
    p.next();
    return { type: 'Number', value: t.value, line: t.line, col: t.col };
  }

  // Identifier — could be variable, member-access, or call.
  if (t.kind === 'IDENT') {
    const id = p.next();
    if (p.peek().kind === 'LPAREN') {
      // Function call.
      p.next(); // consume (
      const args = [];
      if (p.peek().kind !== 'RPAREN') {
        args.push(parseExpr(p));
        while (p.peek().kind === 'COMMA') {
          p.next();
          args.push(parseExpr(p));
        }
      }
      p.expect('RPAREN');
      return { type: 'Call', name: id.value, args, line: id.line, col: id.col };
    }
    if (p.peek().kind === 'DOT') {
      p.next(); // consume .
      const member = p.expect('IDENT');
      if (member.value !== 'x' && member.value !== 'y' && member.value !== 'z') {
        throw new ParseError(`only .x/.y/.z member access (got .${member.value})`,
                             member.line, member.col);
      }
      return { type: 'MemberAccess', name: id.value, member: member.value,
               line: id.line, col: id.col };
    }
    return { type: 'Variable', name: id.value, line: id.line, col: id.col };
  }

  // Parenthesised expression OR vec3 literal.
  if (t.kind === 'LPAREN') {
    p.next();
    const first = parseExpr(p);
    if (p.peek().kind === 'COMMA') {
      // Vec3 literal: (x, y, z)
      p.next();
      const second = parseExpr(p);
      p.expect('COMMA');
      const third  = parseExpr(p);
      p.expect('RPAREN');
      return { type: 'Vec3', x: first, y: second, z: third, line: t.line, col: t.col };
    }
    p.expect('RPAREN');
    return first;
  }

  throw new ParseError(`unexpected token ${t.kind}${t.value != null ? `('${t.value}')` : ''}`,
                       t.line, t.col);
}

// ── Statement parsing ────────────────────────────────────────────────

function parseStmt(p) {
  const t = p.peek();
  if (t.kind === 'IF') {
    p.next();
    p.expect('LPAREN');
    const cond = parseExpr(p);
    p.expect('RPAREN');
    const body = parseStmt(p);
    return { type: 'If', cond, then: body, line: t.line, col: t.col };
  }

  // Assignment vs expression-statement: an assignment starts with IDENT
  // optionally followed by .IDENT, then '='. We peek ahead without
  // committing.
  if (t.kind === 'IDENT') {
    const save = p.i;
    let isAssign = false;
    let targetMember = null;
    // Look ahead: IDENT [ DOT IDENT ] ASSIGN
    if (p.peek(1).kind === 'ASSIGN') {
      isAssign = true;
    } else if (p.peek(1).kind === 'DOT'
            && p.peek(2).kind === 'IDENT'
            && p.peek(3).kind === 'ASSIGN') {
      isAssign = true;
      targetMember = p.peek(2).value;
      if (targetMember !== 'x' && targetMember !== 'y' && targetMember !== 'z') {
        throw new ParseError(`only .x/.y/.z assignment target (got .${targetMember})`,
                             p.peek(2).line, p.peek(2).col);
      }
    }

    if (isAssign) {
      const name = p.next().value;
      let member = null;
      if (p.peek().kind === 'DOT') {
        p.next();
        member = p.expect('IDENT').value;
      }
      p.expect('ASSIGN');
      const value = parseExpr(p);
      p.expect('SEMI');
      return {
        type: 'Assign',
        target: member ? { kind: 'member', name, member } : { kind: 'name', name },
        value,
        line: t.line, col: t.col,
      };
    }
    // Not an assignment — fall through to expression-statement.
    p.i = save;
  }

  // Bare expression statement.
  const expr = parseExpr(p);
  p.expect('SEMI');
  return { type: 'ExprStmt', expr, line: t.line, col: t.col };
}

// ── Public surface ───────────────────────────────────────────────────

/**
 * Parse an ASL source string into a Block AST node.
 * @param {string} src
 * @returns {{ ok: boolean, ast?: object, error?: string, line?: number, col?: number }}
 */
export function parse(src) {
  const tok = tokenize(src);
  if (!tok.ok) return tok;
  const p = new ParserState(tok.tokens);
  try {
    const body = [];
    while (p.peek().kind !== 'EOF') {
      body.push(parseStmt(p));
    }
    return { ok: true, ast: { type: 'Block', body, line: 1, col: 1 } };
  } catch (e) {
    if (e instanceof ParseError) {
      return { ok: false, error: e.message, line: e.line, col: e.col };
    }
    return { ok: false, error: String(e && e.message || e), line: 1, col: 1 };
  }
}

export default parse;
