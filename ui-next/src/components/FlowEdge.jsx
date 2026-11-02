import { useLayoutEffect, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath } from "@xyflow/react";
import { Ban, KeyRound } from "lucide-react";

const COLOR = { active: "var(--blue)", ok: "var(--allow)", key: "var(--allow)", blocked: "var(--block)", leak: "var(--block)" };

// One request path, with an arrowhead and an optional short label saying what flows along it.
// States: idle · active (packet moving) · used · ok · key (allowed, key added) · blocked (stopped at a layer)
// · leak (data reaching a place it must never reach).
export default function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }) {
  const { state = "idle", shape = "bezier", stopAt = 1, stopLabel, label, faded } = data || {};
  const args = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  const [d, lx, ly] = shape === "straight" ? getStraightPath(args)
    : shape === "step" ? getSmoothStepPath({ ...args, borderRadius: 12 }) : getBezierPath(args);
  const ref = useRef(null);
  const [stop, setStop] = useState(null);
  useLayoutEffect(() => {
    if (state !== "blocked" || !ref.current) return setStop(null);
    const p = ref.current.getPointAtLength(ref.current.getTotalLength() * stopAt);
    setStop({ x: p.x, y: p.y });
  }, [d, state, stopAt]);

  const color = COLOR[state];
  return (
    <g className={faded ? "edge-faded" : ""}>
      <path ref={ref} d={d} fill="none" stroke="none" />
      {state === "blocked" ? (
        <>
          <path d={d} className="flow-edge ghost" />
          <path d={d} className="flow-edge blocked" pathLength={1} strokeDasharray={`${stopAt} 1`} />
        </>
      ) : (
        <BaseEdge id={id} path={d} className={`flow-edge ${state}`} markerEnd={markerEnd} />
      )}
      {(state === "active" || state === "key" || state === "blocked" || state === "leak") && (
        <g className="packet" style={{ color }}>
          <circle r={6} fill={color}>
            <animateMotion dur={state === "blocked" ? "1.1s" : "1.5s"} repeatCount="indefinite" path={d}
              keyPoints={`0;${state === "blocked" ? stopAt : 1}`} keyTimes="0;1" calcMode="linear" />
          </circle>
        </g>
      )}
      <EdgeLabelRenderer>
        {stop && (
          <>
            <div className="stop" style={{ left: stop.x, top: stop.y }}><Ban size={18} strokeWidth={2.6} /></div>
            {stopLabel && <div className="edge-chip blocked" style={{ left: stop.x + 24, top: stop.y, transform: "translate(0, -50%)" }}>{stopLabel}</div>}
          </>
        )}
        {state === "key" && (
          <div className="edge-chip key" style={{ left: lx, top: ly - 18 }}><KeyRound size={13} strokeWidth={2.6} /> key added by the gateway</div>
        )}
        {label && state !== "blocked" && state !== "key" && (
          <div className={`edge-label ${state !== "idle" ? "live" : ""} ${faded ? "edge-faded" : ""}`} style={{ left: lx, top: ly }}>{label}</div>
        )}
      </EdgeLabelRenderer>
    </g>
  );
}
