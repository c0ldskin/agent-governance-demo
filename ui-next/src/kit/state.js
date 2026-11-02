// The canvas state after step i of a chapter: each step's changes applied in order.
// A step may carry: edges {id: state} · cards {id: {tags, state}} (merged per card) · layers [control ids that acted]
// · hot (id or ids) · clear (wipe edges before applying) · any other flag, copied as is.
const META = new Set(["t", "verdict", "title", "detail", "layers", "rule", "edges", "cards", "hot", "stage", "clear"]);

export function stateAt(ch, i) {
  const s = { edges: {}, cards: {}, acted: {}, hot: null };
  for (let k = 0; k <= i && k < ch.steps.length; k++) {
    const st = ch.steps[k];
    if (st.clear) s.edges = {};
    for (const [id, v] of Object.entries(st.edges || {})) s.edges[id] = v;
    for (const [id, v] of Object.entries(st.cards || {})) s.cards[id] = { ...s.cards[id], ...v };
    for (const l of st.layers || []) s.acted[l] = (s.acted[l] || 0) + 1;
    for (const [key, v] of Object.entries(st)) if (!META.has(key)) s[key] = v;
    s.hot = st.hot ?? null;
  }
  return s;
}
