// Design mock: one shared shell (kit/Shell.jsx), several demos described as data. Switch with the tabs in the
// top bar, or open /#demo=<id> directly.
import { useEffect, useState } from "react";
import Shell from "./kit/Shell.jsx";
import governance from "./demos/governance.jsx";

const DEMOS = [governance];
const fromHash = () => DEMOS.find((d) => location.hash.includes(`demo=${d.id}`)) || DEMOS[0];

export default function App() {
  const [demo, setDemo] = useState(fromHash);
  useEffect(() => {
    const on = () => setDemo(fromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return <Shell demo={demo} demos={DEMOS} onSwitch={(id) => { location.hash = `demo=${id}`; }} />;
}
