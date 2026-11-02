# ui-next: the shared demo kit (React + React Flow)

A small design system for agent demos: one page shell, one architecture canvas, one set of
cards, line states, focus rules and explainers. Each demo is described as data.

- `src/kit/Shell.jsx`: top bar with chapters, canvas, controls row, right rail (what just happened, timeline,
  what to notice, outcome), explainer sheet. Everything demo-specific comes from a demo definition.
- `src/kit/ArchCanvas.jsx`: draws any architecture from zones, cards and lines described per chapter.
- `src/kit/state.js`: applies a chapter's steps to the canvas.
- `src/demos/governance.jsx`: Agent Governance (its canvas is still the custom `components/Canvas.jsx`).

Agent Governance runs live: `npm run build` writes `../ui/kit`, which `ui/server.py` serves at `/` (assets
under `/kit/`). Live mode comes from `src/live/useLive.js` (the demo's `/api/stream` and `/api/state`),
`src/live/adapter.js` (stream → steps, checked offline with `node dev/replay.mjs`) and
`src/demos/governance.live.js` (which run each chapter starts, the fix approvals, scorecard outcomes).
When no demo answers, the scripted steps play as a mock.

`npm run dev` (http://127.0.0.1:5180) forwards `/api` to the demo on 8776 when it is up;
the demo switcher shows only in mock mode.

Libraries (local `node_modules` only, versions at least two weeks old): React 19.3.1, React Flow
(`@xyflow/react`) 12.12.0, Lucide icons 1.57.0, Motion 14.3.0 (all MIT or ISC), Inter (OFL, bundled, works
offline), Vite 8.3.4 and its React plugin (MIT, build only).
