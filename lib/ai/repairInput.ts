/**
 * The AI's structured answer, put back in the shape its schema asks for (Nov 1: the order splitter answered
 * { orders: "{\"note\": …, \"orders\": [4 orders]}" }, the whole answer written as text inside one field, so 82
 * emails were read as "0 orders" and Dear Heart's four designs became one order). For every field the schema says is a
 * list or an object: text that is JSON is read as JSON, and a whole answer wrapped into one field is unwrapped. Fields
 * inside lists are repaired the same way. Every AI tool goes through here.
 */
type Sch = { type?: string; properties?: Record<string, Sch>; items?: Sch };
export function repairInput(v: unknown, schema: unknown): unknown {
  const sc = (schema || {}) as Sch;
  const parse = (x: unknown) => { if (typeof x !== "string") return x; const t = x.trim(); if (!/^[[{]/.test(t)) return x; try { return JSON.parse(t); } catch { return x; } };
  if (sc.type === "object" && sc.properties) {
    let o = parse(v);
    if (!o || typeof o !== "object" || Array.isArray(o)) return v;
    const props = sc.properties, keys = Object.keys(props);
    // the whole answer inside one of its fields: { orders: "{ note, orders: [...] }" } → { note, orders: [...] }
    for (const k of keys) {
      const inner = parse((o as Record<string, unknown>)[k]);
      if (inner && typeof inner === "object" && !Array.isArray(inner) && props[k].type !== "object" && k in (inner as Record<string, unknown>)) {
        o = { ...(o as Record<string, unknown>), ...(inner as Record<string, unknown>) };
        break;
      }
    }
    const out: Record<string, unknown> = { ...(o as Record<string, unknown>) };
    for (const k of keys) if (k in out) out[k] = repairInput(out[k], props[k]);
    return out;
  }
  if (sc.type === "array") {
    const a = parse(v);
    if (!Array.isArray(a)) return v;
    return sc.items ? a.map((x) => repairInput(x, sc.items)) : a;
  }
  return v;
}

