import type {
  BandVm,
  CardVm,
  HostMessage,
  KanbanVm,
  BacklogVm,
  ReportVm,
  StripVm,
  ViewModel,
  WebviewMessage,
} from "../../model/protocol.ts";

/**
 * The webview.
 *
 * It renders what it is handed and emits INTENT. It never mutates, never
 * derives, and holds no state across messages (AD-11) — its only state is
 * scroll, focus, and in-flight text input.
 *
 * v1 shipped its webview JS as template-literal strings inside a .ts file:
 * zero type-checking on either side of the protocol. This file is bundled and
 * shares its types with the host, so the envelope is checked at compile time.
 */

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewMessage): void;
  getState(): unknown;
  setState(s: unknown): void;
};

const vscode = acquireVsCodeApi();
const post = (m: WebviewMessage): void => vscode.postMessage(m);

const app = document.getElementById("app")!;

/** No innerHTML anywhere: every value here is user text. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function header(vm: ViewModel): HTMLElement {
  const head = el("div", "wb-head");

  const seg = el("div", "seg");
  for (const mode of ["backlog", "kanban", "report"] as const) {
    const b = el("button", vm.mode === mode ? "on" : undefined, label(mode));
    b.onclick = () => post({ type: "setMode", mode });
    seg.append(b);
  }
  head.append(seg);

  // AD-7 — the live root, always on screen. Not a notification, not dismissible.
  const root = el("div", `wb-root${vm.rootKind === "local" ? " local" : ""}`);
  root.textContent = vm.rootKind === "local" ? ".leaddeck (local)" : vm.root;
  root.title = vm.root;
  head.append(root);

  return head;
}

const label = (m: string): string => m.charAt(0).toUpperCase() + m.slice(1);

function ruleBar(text: string): HTMLElement {
  const r = el("div", "rule");
  r.append(el("span", "lbl", "rule"), el("span", undefined, text));
  return r;
}

function pipEl(p: { id: string; title: string; state: string; wk: boolean }): HTMLElement {
  const n = el("span", `pip ${p.state}${p.wk ? " wk" : ""}`);
  // A pip cannot be read for a title. You hover, or you expand. Trade accepted.
  n.title = p.title;
  return n;
}

function stripEl(s: StripVm): HTMLElement {
  const row = el("div", "strip");
  row.append(el("span", "grip", "⣿"), el("span", "p-name", s.title));

  const pips = el("div", "pips");
  for (const p of s.pips) pips.append(pipEl(p));
  row.append(pips);

  const right = el("div", "p-right");
  right.append(el("span", "frac", `${s.done}/${s.total}`));
  right.append(el("span", `sig ${s.signal.tone}`, s.signal.text));

  const who = el("span", "who");
  if (s.who) {
    const g = el("span", s.who.glyph === "↑" ? "up" : "down", `${s.who.glyph} ${s.who.label}`);
    who.append(g);
  } else {
    who.append(el("span", "none", "—"));
  }
  right.append(who);
  row.append(right);
  return row;
}

function bandEl(b: BandVm): HTMLElement {
  const band = el("div", `band ${b.kind}`);

  const h = el("div", "band-h");
  h.append(el("span", "band-name", b.label), el("span", "band-why", b.predicate));

  const n = el("span", "band-n");
  if (b.kind === "unsorted") {
    // The only row on the shelf whose target value is zero.
    const age = b.oldestCaptureDays !== null ? ` · oldest ${b.oldestCaptureDays}d` : "";
    n.textContent = `${b.count} unsorted${age}`;
    h.onclick = () => post({ type: "openDrain" });
  } else {
    n.textContent = String(b.count);
  }
  h.append(n);
  band.append(h);

  if (b.kind === "unsorted" && b.captures.length > 0) {
    // Captures are raw pips ON THE BAND, with no strip. A band is not a project
    // — that is what keeps "one pip = one real task" true for every strip.
    const row = el("div", "unsorted-pips");
    row.append(el("span"), el("span"));
    const pips = el("div", "pips");
    for (const c of b.captures) {
      const p = el("span", "pip raw");
      p.title = c.text;
      pips.append(p);
    }
    row.append(pips, el("span"));
    band.append(row);
  }

  for (const s of b.strips) band.append(stripEl(s));
  return band;
}

function drainEl(d: NonNullable<BacklogVm["drain"]>): HTMLElement {
  const wrap = el("div", "drain");

  const top = el("div", "drain-top");
  top.append(el("span", "drain-q", "what is this?"));
  const count = el("span", "drain-count");
  count.append(el("b", undefined, String(d.captures.length)), document.createTextNode(" left"));
  top.append(count);
  wrap.append(top);

  // SHOW-ALL. Every capture at once, resolvable in any order. No queue, no
  // countdown, no one-at-a-time -- a wizard demands completion, and he
  // explicitly does not complete.
  const list = el("div", "drain-list");
  for (const c of d.captures) {
    const row = el("div", "dc");
    row.append(el("span", "txt", c.text));
    row.append(el("span", "when", c.ageDays === 0 ? "today" : `${c.ageDays}d`));

    // All resolutions are peers. Create is not privileged, and neither is death.
    const acts = el("div", "acts");
    const task = el("button", "btn pri", "→ task");
    task.onclick = () => post({ type: "resolveCapture", id: c.id, to: "task" });
    const project = el("button", "btn", "→ project");
    project.title = "it is not a task — it is a whole thing";
    project.onclick = () => post({ type: "resolveCapture", id: c.id, to: "project" });
    const bin = el("button", "btn death", "let it die");
    bin.onclick = () => post({ type: "resolveCapture", id: c.id, to: "bin", reason: "outdated" });
    acts.append(task, project, bin);
    row.append(acts);
    list.append(row);
  }
  wrap.append(list);

  const foot = el("div", "drain-foot");
  // Resolve 3, leave 8. There is no guilt copy here, and that is deliberate.
  foot.append(el("span", undefined, "resolve any, in any order — leaving some is fine"));
  const esc = el("button", "btn esc", "Esc — stop");
  esc.onclick = () => post({ type: "closeDrain" });
  foot.append(esc);
  wrap.append(foot);
  return wrap;
}

function backlogEl(b: BacklogVm): HTMLElement {
  const shelf = el("div", `shelf scroll${b.drain ? " draining" : ""}`);
  for (const band of b.bands) {
    shelf.append(bandEl(band));
    if (band.kind === "unsorted" && b.drain) shelf.append(drainEl(b.drain));
  }
  if (b.bands.length === 0) {
    // Not onboarding — a stated fact. He is not a stranger to his own tool, but
    // an empty screen reads as broken, and "empty" and "broken" must not look
    // the same. The chord comes from the host: it is platform-resolved, and
    // `derive/` cannot reach `vscode` to know it.
    shelf.append(
      el("div", "empty", `no projects, no tasks, nothing captured — ${b.captureChord} to capture`),
    );
  }
  return shelf;
}

function cardEl(c: CardVm): HTMLElement {
  const t = el("div", `t ${c.tone}${c.done ? " done" : ""}`);
  t.draggable = true;
  t.dataset["id"] = c.id;
  t.append(el("div", "t-title", c.title));
  const meta = el("div", "t-meta");
  meta.append(el("span", undefined, c.project), el("span", `sig ${c.signal.tone}`, c.signal.text));
  t.append(meta);
  t.ondragstart = (e) => {
    e.dataTransfer?.setData("text/plain", c.id);
    t.classList.add("dragging");
  };
  t.ondragend = () => t.classList.remove("dragging");
  return t;
}

function kanbanEl(k: KanbanVm): HTMLElement {
  const kb = el("div", "kb");
  for (const col of k.columns) {
    const c = el("div", "kb-col");
    const h = el("div", "kb-col-h");
    h.append(el("span", undefined, col.label), el("b", undefined, String(col.cards.length)));
    c.append(h);

    const list = el("div", "kb-list scroll");
    for (const card of col.cards) list.append(cardEl(card));
    c.append(list);

    // Drag within the single webview only. Cross-tab drag is impossible, so no
    // workflow may assume it.
    c.ondragover = (e) => {
      e.preventDefault();
      c.classList.add("over");
    };
    c.ondragleave = () => c.classList.remove("over");
    c.ondrop = (e) => {
      e.preventDefault();
      c.classList.remove("over");
      const id = e.dataTransfer?.getData("text/plain");
      if (!id) return;
      if (col.key === "blocked") return; // blocked is DERIVED — you cannot drag into it.
      const status = col.key === "done" ? "done" : col.key === "doing" ? "doing" : "todo";
      post({ type: "setStatus", id: id as never, status });
    };
    kb.append(c);
  }
  return kb;
}

function section(name: string, note: string): HTMLElement {
  const h = el("div", "pg-sec-h");
  h.append(el("span", "pg-sec-n", name), el("span", "pg-sec-w", note));
  return h;
}

function reportEl(r: ReportVm): HTMLElement {
  const pg = el("div", "pg scroll");

  const risk = el("div", "pg-sec");
  risk.append(section("① At risk", "what needs a decision"));
  const risks = el("div", "risks");
  for (const a of r.atRisk) {
    const card = el("div", `risk ${a.tone}`);
    card.append(el("div", "risk-n", a.title), el("div", "risk-why", a.why));
    risks.append(card);
  }
  if (r.atRisk.length === 0) risks.append(el("div", "empty", "nothing at risk"));
  risk.append(risks);
  pg.append(risk);

  const week = el("div", "pg-sec");
  week.append(section("② The week", r.week));
  const three = el("div", "rp3");
  three.append(
    column("done", "What happened", r.happened.map((h) => ({ id: h.id, title: h.title, meta: h.project }))),
    column("stuck", "Where I'm stuck", r.stuck.map((s) => ({ id: s.id, title: s.title, meta: s.why }))),
    column("next", "Next", r.next.map((n) => ({ id: n.id, title: n.title, meta: n.project }))),
  );
  week.append(three);

  const note = el("div", "rp-note");
  note.textContent =
    "⟨ pull ⟩ inserts a stub — a title and a cursor. The sentence is yours; the app cannot write it.";
  week.append(note);
  pg.append(week);

  const openBtn = el("button", "btn", `⧉ open ${r.reportPath}`);
  openBtn.onclick = () => post({ type: "openReport" });
  const foot = el("div", "rp-note");
  foot.append(openBtn);
  pg.append(foot);

  return pg;
}

function column(
  kind: string,
  name: string,
  rows: { id: string; title: string; meta: string }[],
): HTMLElement {
  const c = el("div", `rp3-c ${kind}`);
  const h = el("div", "rp3-h");
  h.append(el("span", "rp3-n", name), el("span", "rp3-b", String(rows.length)));
  c.append(h);

  const list = el("div", "rp3-l");
  for (const r of rows) {
    const row = el("div", "ri");
    row.append(el("span", "rt", r.title), el("span", "rp", r.meta));
    const add = el("button", "add", "⟨ pull ⟩");
    add.onclick = () => post({ type: "pull", id: r.id as never });
    row.append(add);
    list.append(row);
  }
  if (rows.length === 0) list.append(el("div", "empty", "—"));
  c.append(list);
  return c;
}

function render(vm: ViewModel): void {
  app.replaceChildren();
  app.append(header(vm));

  if (vm.mode === "backlog" && vm.backlog) {
    app.append(ruleBar(vm.backlog.rule), backlogEl(vm.backlog));
  } else if (vm.mode === "kanban" && vm.kanban) {
    app.append(ruleBar(vm.kanban.rule), kanbanEl(vm.kanban));
  } else if (vm.mode === "report" && vm.report) {
    app.append(ruleBar(vm.report.rule), reportEl(vm.report));
  }
}

window.addEventListener("message", (e: MessageEvent<HostMessage>) => {
  if (e.data.type === "render") render(e.data.vm);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") post({ type: "closeDrain" });
});

post({ type: "ready" });
