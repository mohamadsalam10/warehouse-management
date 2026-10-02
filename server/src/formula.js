// Tiny, safe arithmetic evaluator for salary component formulas.
// Supports + - * / ( ), decimals, and named variables (e.g. x, base).
// Returns 0 on any error. No access to JS scope (no Function/eval).
function evalFormula(expr, vars = {}) {
  if (expr == null || expr === "") return 0;
  try {
    const tokens = tokenize(String(expr), vars);
    const rpn = toRPN(tokens);
    const val = evalRPN(rpn);
    return Number.isFinite(val) ? val : 0;
  } catch { return 0; }
}

function tokenize(s, vars) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") { i++; continue; }
    if ("+-*/()".includes(c)) { out.push({ t: c }); i++; continue; }
    if (/[0-9.]/.test(c)) { let j = i + 1; while (j < s.length && /[0-9.]/.test(s[j])) j++; out.push({ t: "num", v: parseFloat(s.slice(i, j)) }); i = j; continue; }
    if (/[a-zA-Z_]/.test(c)) { let j = i + 1; while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++; const name = s.slice(i, j); if (!(name in vars)) throw new Error("unknown var " + name); out.push({ t: "num", v: Number(vars[name]) || 0 }); i = j; continue; }
    throw new Error("bad char " + c);
  }
  return out;
}
const PREC = { "+": 1, "-": 1, "*": 2, "/": 2 };
function toRPN(tokens) {
  const out = [], ops = [];
  let prevType = null;
  for (const tk of tokens) {
    if (tk.t === "num") out.push(tk);
    else if (tk.t === "(") ops.push(tk);
    else if (tk.t === ")") { while (ops.length && ops[ops.length - 1].t !== "(") out.push(ops.pop()); if (!ops.length) throw new Error("paren"); ops.pop(); }
    else { // operator; handle unary minus/plus
      if ((tk.t === "-" || tk.t === "+") && (prevType === null || prevType === "op" || prevType === "(")) { out.push({ t: "num", v: 0 }); }
      while (ops.length && "+-*/".includes(ops[ops.length - 1].t) && PREC[ops[ops.length - 1].t] >= PREC[tk.t]) out.push(ops.pop());
      ops.push(tk);
    }
    prevType = tk.t === "num" ? "num" : tk.t === ")" ? "num" : tk.t === "(" ? "(" : "op";
  }
  while (ops.length) { const o = ops.pop(); if (o.t === "(") throw new Error("paren"); out.push(o); }
  return out;
}
function evalRPN(rpn) {
  const st = [];
  for (const tk of rpn) {
    if (tk.t === "num") st.push(tk.v);
    else { const b = st.pop(), a = st.pop(); if (a === undefined || b === undefined) throw new Error("stack"); st.push(tk.t === "+" ? a + b : tk.t === "-" ? a - b : tk.t === "*" ? a * b : b === 0 ? 0 : a / b); }
  }
  if (st.length !== 1) throw new Error("eval");
  return st[0];
}
module.exports = { evalFormula };
