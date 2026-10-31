/** An order training's changes (lib/ai/trainingChat.ts), for the chat's "Changes to the training" card. */
export type TrainPart = { t: string; k: "same" | "add" | "del" | "gap" };
export type TrainLine = { op: "+" | "-" | "~"; text: string; old?: string; parts?: TrainPart[] };

/** a rewritten paragraph word by word: what was added and taken out, with long unchanged stretches shortened to "…" */
export function wordDiff(before: string, after: string): TrainPart[] {
  // punctuation is its own word, so "Front," → "Front at 2.5" wide," marks only what was added
  const toks = (x: string) => x.match(/[^\s,;:()]+|[,;:()]/g) || [];
  const a = toks(before), b = toks(after);
  const n = a.length, m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const words: { w: string; k: "same" | "add" | "del" }[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { words.push({ w: b[j], k: "same" }); i++; j++; }
    else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) words.push({ w: a[i++], k: "del" });
    else words.push({ w: b[j++], k: "add" });
  }
  const parts: TrainPart[] = [];
  for (let x = 0; x < words.length;) {
    let y = x;
    while (y < words.length && words[y].k === words[x].k) y++;
    const run = words.slice(x, y).map((v) => v.w), k = words[x].k;
    const join = (ws: string[]) => ws.join(" ").replace(/ ([,;:)])/g, "$1").replace(/\( /g, "(");
    if (k === "same" && run.length > 18) {
      const head = x === 0 ? [] : run.slice(0, 7), tail = y === words.length ? [] : run.slice(-7);
      if (head.length) parts.push({ t: join(head), k: "same" });
      parts.push({ t: "…", k: "gap" });
      if (tail.length) parts.push({ t: join(tail), k: "same" });
    } else parts.push({ t: join(run), k });
    x = y;
  }
  return parts;
}

/** what changed, paragraph by paragraph: kept ones left out, a removed one followed by an added one is a change */
export function trainingDiff(before: string, after: string): TrainLine[] {
  const a = before.split("\n").map((s) => s.trim()).filter(Boolean), b = after.split("\n").map((s) => s.trim()).filter(Boolean);
  const n = a.length, m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const raw: TrainLine[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { i++; j++; continue; }
    // removals before additions, so a rewritten paragraph pairs up below
    if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) raw.push({ op: "-", text: a[i++] });
    else raw.push({ op: "+", text: b[j++] });
  }
  // pair removals with the additions right after them: that paragraph was rewritten
  const out: TrainLine[] = [];
  for (let k = 0; k < raw.length; k++) {
    const minus: TrainLine[] = [];
    while (k < raw.length && raw[k].op === "-") minus.push(raw[k++]);
    const plus: TrainLine[] = [];
    while (k < raw.length && raw[k].op === "+") plus.push(raw[k++]);
    k--;
    const pairs = Math.min(minus.length, plus.length);
    for (let p = 0; p < pairs; p++) out.push({ op: "~", text: plus[p].text, old: minus[p].text, parts: wordDiff(minus[p].text, plus[p].text) });
    out.push(...minus.slice(pairs), ...plus.slice(pairs));
  }
  return out;
}
