// A generic architecture canvas: a demo describes its zones, cards and lines as data, per chapter and state,
// and this draws them with the shared cards, line states, arrows, labels and focus.
//
//   graph(chapter, st) -> { zones: [{ id, x, y, w, h, label, icon, variant }],
//                           cards: [{ id, kind, x, y, w, h, icon, title, sub, tags: [[text, tone, Icon?]], num, exits }],
//                           edges: [[id, source, sourceHandle, target, targetHandle, { shape, label, stopLabel }]] }
// Card kinds: person · docs · agent · agent-hi · tool · human · outcome · ext. `st.hot` (id or ids) is the focus.
import { useEffect, useMemo } from "react";
import { Background, BackgroundVariant, Handle, MarkerType, Position, ReactFlow, useReactFlow } from "@xyflow/react";
import FlowEdge from "../components/FlowEdge.jsx";

const COLOR = { idle: "var(--edge-idle)", active: "var(--blue)", used: "var(--blue)", ok: "var(--allow)", key: "var(--allow)", leak: "var(--block)" };
const ICO = { person: "person", docs: "doc", agent: "agent", "agent-hi": "agent-hi", tool: "svc", human: "human", outcome: "svc", ext: "ext" };

const H = ({ id, pos, type = "source", style }) => <Handle id={id} type={type} position={pos} style={style} isConnectable={false} />;

function Zone({ data }) {
  const Icon = data.icon;
  return <div className={`zone ${data.variant || ""} ${data.recede ? "recede" : ""}`}><div className="zone-label">{Icon && <Icon size={13} strokeWidth={2.4} />}{data.label}</div></div>;
}

function Card({ data }) {
  const Icon = data.icon;
  return (
    <div className={`card k-${data.kind} ${data.hot ? "hot" : ""} ${data.recede ? "recede" : ""} ${data.state || ""}`}>
      <div className="row">
        <div className={`ico ${ICO[data.kind] || "svc"}`}><Icon size={20} /></div>
        <div><h3>{data.title}{data.num ? <span className="lnum">{data.num}</span> : null}</h3><div className="sub">{data.sub}</div></div>
        {data.hot && data.kind.startsWith("agent") && <span className="working" />}
      </div>
      {data.tags?.length > 0 && (
        <div className="meta">
          {data.tags.map(([text, tone, TagIcon]) => (
            <span key={text} className={`tag ${tone || ""}`}>{TagIcon && <TagIcon size={11} strokeWidth={2.6} />}{text}</span>
          ))}
        </div>
      )}
      <H id="r" pos={Position.Right} /><H id="rt" pos={Position.Right} type="target" /><H id="l" pos={Position.Left} type="target" />
      <H id="ls" pos={Position.Left} /><H id="t" pos={Position.Top} type="target" /><H id="b" pos={Position.Bottom} />
      <H id="ts" pos={Position.Top} /><H id="bt" pos={Position.Bottom} type="target" />
    </div>
  );
}

const nodeTypes = { zone: Zone, card: Card };
const edgeTypes = { flow: FlowEdge };

function AutoFit({ chapter }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const el = document.querySelector(".canvas");
    const ro = new ResizeObserver(() => fitView({ padding: 0.06 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitView]);
  useEffect(() => {
    const h = setTimeout(() => fitView({ padding: 0.06, duration: 600 }), 80);
    return () => clearTimeout(h);
  }, [chapter, fitView]);
  return null;
}

export default function ArchCanvas({ graph, chapter, st, focusChapters = [] }) {
  const g = useMemo(() => graph(chapter, st), [graph, chapter, st]);
  const hot = Array.isArray(st.hot) ? st.hot : st.hot ? [st.hot] : [];
  const focus = focusChapters.includes(chapter) && hot.length > 0;   // on a tour, everything but the current step steps back
  const isHot = (id) => hot.includes(id);

  const nodes = useMemo(() => [
    ...g.zones.map((z) => ({ id: z.id, type: "zone", position: { x: z.x, y: z.y }, style: { width: z.w, height: z.h }, zIndex: -1, selectable: false,
      data: { label: z.label, icon: z.icon, variant: z.variant, recede: focus } })),
    ...g.cards.map((c) => ({ id: c.id, type: "card", position: { x: c.x, y: c.y }, style: { width: c.w, height: c.h },
      data: { ...c, hot: isHot(c.id), recede: focus && !isHot(c.id) } })),
  ], [g, focus, hot.join()]);

  const edges = useMemo(() => g.edges.map(([id, source, sourceHandle, target, targetHandle, extra = {}]) => {
    let state = st.edges[id] || "idle";
    let more = {};
    if (state === "refused") { state = "blocked"; more = { stopAt: 0.5 }; }
    const faded = focus && !(isHot(source) || isHot(target));
    return {
      id, source, sourceHandle, target, targetHandle, type: "flow", zIndex: state !== "idle" ? 2 : 0,
      markerEnd: state === "blocked" ? undefined : { type: MarkerType.ArrowClosed, width: 14, height: 14, color: COLOR[state] || COLOR.idle },
      data: { shape: "bezier", ...extra, ...more, state, faded },
    };
  }), [g, st, focus, hot.join()]);

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.06 }}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} panOnDrag={false}
      zoomOnDoubleClick={false} preventScrolling={false} minZoom={0.3}>
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--dots)" />
      <AutoFit chapter={chapter} />
    </ReactFlow>
  );
}
