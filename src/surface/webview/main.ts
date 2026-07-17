import type { Burndown } from "../../derive/burndown.ts";
import type {
  BandVm,
  CardVm,
  HostMessage,
  KanbanVm,
  BacklogVm,
  ReportVm,
  SheetVm,
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

/** SVG needs its own namespace; `el` builds HTML only. Attributes, no children. */
function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
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
  n.onclick = (e) => {
    // The strip opens the project; a pip opens its task. Without this the
    // project sheet would always win.
    e.stopPropagation();
    post({ type: "openSheet", kind: "task", id: p.id as never });
  };
  return n;
}

function stripEl(s: StripVm): HTMLElement {
  // The wrapper holds the dense bar AND the readable task list. A CLICK on the
  // row now folds/unfolds that list (was hover), and the state persists — the
  // titles stay open until he folds them. Editing the project moved to its own
  // ✎ button, so the primary click is the one he asked for.
  const wrap = el("div", `strip-wrap${s.open ? " open" : ""}`);

  const row = el("div", "strip");
  row.onclick = () => post({ type: "toggleStrip", id: s.id });
  // A chevron states the fold, so the row reads as expandable, not as a mystery.
  row.append(el("span", "chev", s.open ? "▾" : "▸"), el("span", "p-name", s.title));

  const pips = el("div", "pips");
  for (const p of s.pips) pips.append(pipEl(p));
  row.append(pips);

  // Edit the project itself — a distinct gesture from folding its tasks.
  const edit = el("button", "p-edit", "✎");
  edit.title = "edit this project";
  edit.onclick = (e) => {
    e.stopPropagation(); // else the row's click folds/unfolds instead.
    post({ type: "openSheet", kind: "project", id: s.id });
  };
  row.append(edit);

  // The way work is born on a strip he is already looking at. Without it the
  // drain is the only road onto the shelf, and a project he just made is a dead
  // end.
  const addTask = el("button", "p-add", "＋");
  addTask.title = "add a task to this project";
  addTask.onclick = (e) => {
    e.stopPropagation(); // else the strip's own click folds/unfolds.
    post({ type: "newTask", project: s.id as never });
  };
  row.append(addTask);

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

  wrap.append(row, stripTasksEl(s));
  return wrap;
}

/** Glyph for a pip's state — the same fact the pip's colour carries, in text. */
function stateGlyph(state: string): string {
  switch (state) {
    case "done":
      return "✓";
    case "doing":
      return "▸";
    case "block":
      return "⊘";
    case "stale":
      return "◦";
    default:
      return "•"; // todo / raw
  }
}

/**
 * The readable list under a strip — one row per task, title you can read, and
 * the ONE action the shelf owes: commit to the shown week (FR-13). `‹ this week`
 * commits; a task already committed shows `✓ this week`, click to release.
 *
 * Deliberately ONE button per row. The shelf is where v1 died of controls, so
 * this list earns its place by staying a list — not a second sheet. Everything
 * else (status, deadline, notes) is the sheet's job, a click away on the title.
 */
function stripTasksEl(s: StripVm): HTMLElement {
  const list = el("div", "strip-tasks");
  // A SINGLE inner wrapper between the grid and the rows: the `0fr → 1fr`
  // collapse only works on one grid child. With the rows as direct children,
  // each became its own `auto` track and kept its height at rest — the residual
  // band Cédric saw. One wrapper, one collapsible track.
  const inner = el("div", "st-inner");
  for (const p of s.pips) {
    const item = el("div", `st-row ${p.state}`);

    const title = el("button", "st-title");
    title.append(el("span", "st-g", stateGlyph(p.state)), document.createTextNode(p.title));
    title.onclick = () => post({ type: "openSheet", kind: "task", id: p.id as never });

    const done = p.state === "done";
    // A finished task is not committed-to-a-week material — the week is about
    // what's still ahead, so done rows show no commit action, only the title.
    const commit = el("button", `st-commit${p.wk ? " on" : ""}`);
    if (done) {
      commit.className = "st-commit ghost";
      commit.textContent = "done";
      commit.disabled = true;
    } else if (p.wk) {
      commit.textContent = "✓ this week";
      commit.title = "committed — click to release";
      commit.onclick = () => post({ type: "uncommit", id: p.id as never });
    } else {
      commit.textContent = "→ this week";
      commit.title = "commit to the shown week";
      commit.onclick = () => post({ type: "commit", id: p.id as never });
    }

    item.append(title, commit);
    inner.append(item);
  }
  list.append(inner);
  return list;
}

function bandEl(b: BandVm, sheet: SheetVm | null): HTMLElement {
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
    // Five spacers + pips = the strip's six columns (chev·name·pips·✎·＋·right).
    // A capture has no ✎ and no ＋: it has no project — that is the drain's job.
    row.append(pips, el("span"), el("span"), el("span"));
    band.append(row);
  }

  // The sheet unfolds UNDER ITS OWN ROW, in the shelf's own flow — not at the
  // foot of the band. With 17 projects in QUIET, appending after the band put
  // the editor 17 rows below the strip he clicked, which reads as "it opened
  // somewhere else" rather than "it opened here".
  for (const s of b.strips) {
    band.append(stripEl(s));
    if (sheet && (s.id === sheet.id || s.pips.some((p) => p.id === sheet.id))) {
      band.append(sheetEl(sheet));
    }
  }
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
    task.title = "new work, no home yet — it lands in the Inbox";
    task.onclick = () => post({ type: "resolveCapture", id: c.id, to: "task" });
    // FR-8's two note destinations behind one button: the picker decides whether
    // the target is a task or a project, because he is looking for a THING, not
    // choosing a type first.
    const note = el("button", "btn", "→ note on…");
    note.title = "it is not new work — it is news about work you already have";
    note.onclick = () => post({ type: "resolveCapture", id: c.id, to: "note" });
    const bin = el("button", "btn death", "let it die");
    bin.onclick = () => post({ type: "resolveCapture", id: c.id, to: "bin", reason: "outdated" });
    acts.append(task, note, bin);
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

/**
 * The sheet — the editor.
 *
 * It unfolds in the shelf's own flow: not a region, not an overlay, not a tab.
 * The 2-column split was rejected because halving the width stops the pips
 * fitting, and it is the shape that produced v1's five panels.
 *
 * Saves as you type. There is no save button in here, and there must never be.
 */
function sheetEl(s: SheetVm): HTMLElement {
  const ed = el("div", `ed${s.death ? " dead" : ""}`);

  // header
  const h = el("div", "ed-h");
  h.append(el("span", `ed-kind${s.kind === "project" ? " proj" : ""}`, s.kind));
  if (s.crumb) h.append(el("span", "ed-crumb", s.crumb));
  // The only persistence surface. There is no unsaved state to show.
  h.append(el("span", "ed-saved", "● saved"));
  const close = el("button", "ed-close", "esc");
  close.onclick = () => post({ type: "closeSheet" });
  h.append(close);
  ed.append(h);

  // title + status
  const titleRow = el("div", "ed-title");
  const title = el("input", "ed-title-in") as HTMLInputElement;
  title.value = s.title;
  title.spellcheck = false;
  title.dataset["focus"] = "title";
  // Born empty, from `＋ task` or `＋ project`. The name is the ONE thing it
  // needs, so the caret starts there — `withFocus` only restores focus that
  // already existed, and without this the gesture ends on a field he must click.
  if (s.title === "") {
    title.placeholder = s.kind === "task" ? "what is it?" : "name it";
    title.autofocus = true;
  }
  // AD-14: text input is the ONE place the webview leads. It debounces here;
  // everything else writes immediately.
  title.oninput = debounce(() => post({ type: "setTitle", value: title.value }), 250);
  titleRow.append(title);

  if (s.status !== null) {
    const st = el("div", "ed-status");
    for (const v of ["todo", "doing", "done"] as const) {
      const b = el("span", s.status === v ? `on${v === "done" ? " dn" : ""}` : undefined, v);
      b.onclick = () => post({ type: "setSheetStatus", status: v });
      st.append(b);
    }
    titleRow.append(st);
  } else {
    // A project isn't a task. Say so, rather than leaving a gap where a control
    // used to be.
    titleRow.append(el("span", "ed-nostatus", "no todo/doing/done — a project isn't a task"));
  }
  ed.append(titleRow);

  // the computed signal: read-only, never a control
  const sig = el("div", "ed-sig");
  sig.append(el("span", "lbl", "computed"));
  sig.append(el("span", `val${s.signal.kind === "quiet" ? " q" : ""}`, s.signal.text));
  sig.append(el("span", "why", `— ${s.signalWhy}`));
  sig.append(el("span", "ro", "read-only · never a control"));
  ed.append(sig);

  const body = el("div", "ed-fields");
  // A field shows when it is in `s.fields` — with "show all" that is every field
  // the kind allows, whether or not it holds a value. Its VALUE may still be
  // null, which now means "empty", and each field renders its own empty state.
  const has = (f: string): boolean => s.fields.includes(f as never);

  if (has("deadline")) {
    body.append(
      field(
        "deadline",
        dateInput(s.deadline ?? "", (v) => post({ type: "setDeadline", value: v })),
        () => post({ type: "removeField", field: "deadline" }),
      ),
    );
  }

  if (has("description")) {
    const ta = el("textarea", "inp multi") as HTMLTextAreaElement;
    ta.value = (s.description ?? "").trim();
    ta.rows = 2;
    ta.spellcheck = false;
    ta.dataset["focus"] = "description";
    ta.oninput = debounce(() => post({ type: "setDescription", value: ta.value }), 250);
    body.append(field("description", ta, () => post({ type: "removeField", field: "description" })));
  }

  if (has("commit")) {
    const wrap = el("div", "commit");
    // A row of weeks — this week and the next five (FR-13). Click one to commit
    // to it; click the current one again to release. The model always allowed
    // any week; the old UI only ever offered "this week", which was the bug.
    const weeks = el("div", "commit-weeks");
    for (const w of s.commitWeeks) {
      const b = el("button", `commit-wk${w.current ? " on" : ""}`, w.label);
      b.title = w.weekOf;
      b.onclick = () =>
        post({ type: "setCommit", weekOf: w.current ? null : (w.weekOf as never) });
      weeks.append(b);
    }
    wrap.append(weeks);
    body.append(field("the week", wrap, null, "the only judgment you author"));
  }

  if (has("subtasks")) body.append(subtasksEl(s.subtasks ?? []));
  if (has("stakeholders")) body.append(stakeholdersEl(s.stakeholders ?? []));
  if (has("tags")) body.append(tagsEl(s.tags ?? []));
  if (has("log")) {
    const logField = logEl(s.log ?? []);
    // Tagged so a WIDE sheet can float the log into a right-hand column (the
    // 2-col split, but only when there is room — a container query decides).
    logField.classList.add("fs-log");
    body.append(logField);
  }

  ed.append(body);

  // the rail: depth on demand (empty when the sheet shows all fields)
  if (s.rail.length > 0) {
    const rail = el("div", "depth");
    rail.append(el("span", "depth-l", "add when you need it"));
    for (const r of s.rail) {
      const b = el("button", "depth-b");
      b.append(document.createTextNode(r.label), el("span", "k", r.chord));
      b.onclick = () => post({ type: "addField", field: r.field });
      rail.append(b);
    }
    ed.append(rail);
  }

  // "let it die" lives with the sheet, not the rail — with show-all the rail is
  // empty, and ending a task must not vanish with it.
  if (s.kind === "task" && !s.death) {
    const dieBar = el("div", "die-bar");
    const die = el("button", "depth-b die");
    die.append(document.createTextNode("⊗ let it die"));
    die.onclick = () => {
      const w = ed.querySelector(".die");
      w?.classList.toggle("open");
    };
    dieBar.append(die);
    ed.append(dieBar);
  }

  // death: purple, never red. An ending, not a failure.
  if (s.kind === "task") {
    const die = el("div", `die${s.death ? " open" : ""}`);
    die.append(el("span", "die-q", s.death ? "died —" : "let it die?"));
    const why = el("div", "why");
    for (const r of ["outdated", "delegated", "cancelled"] as const) {
      const chip = el("span", s.death?.reason === r ? "on" : undefined, r);
      chip.onclick = () => post({ type: "letItDie", reason: r });
      why.append(chip);
    }
    die.append(why);
    die.append(el("span", "die-note", "the reason is the record — nothing computes why"));
    if (s.death) {
      const undo = el("button", "btn", "bring it back");
      undo.onclick = () => post({ type: "undie" });
      die.append(undo);
    }
    ed.append(die);
  }

  return ed;
}

function field(
  label: string,
  control: HTMLElement,
  onRemove: (() => void) | null,
  note?: string,
): HTMLElement {
  const fs = el("div", "fs");
  const h = el("div", "fs-h");
  h.append(el("span", "fs-n", label));
  if (note) h.append(el("span", "fs-w", note));
  if (onRemove) {
    const rm = el("button", "btn ghost", `− remove ${label}`);
    rm.onclick = onRemove;
    const a = el("span", "fs-a");
    a.append(rm);
    h.append(a);
  }
  fs.append(h, control);
  return fs;
}

function dateInput(value: string, onChange: (v: string | null) => void): HTMLElement {
  const i = el("input", "inp mono") as HTMLInputElement;
  i.type = "date";
  i.value = value;
  i.onchange = () => onChange(i.value === "" ? null : i.value);
  return i;
}

function subtasksEl(subtasks: { text: string; done: boolean }[]): HTMLElement {
  const list = el("div", "sub-l");
  subtasks.forEach((st, i) => {
    const row = el("div", `st${st.done ? " dn" : ""}`);
    const box = el("span", `box${st.done ? " on" : ""}`, st.done ? "☑" : "☐");
    box.onclick = () => post({ type: "toggleSubtask", index: i });
    const lb = el("input", "lb-in") as HTMLInputElement;
    lb.value = st.text;
    lb.placeholder = "…";
    lb.dataset["focus"] = `subtask-${i}`;
    lb.oninput = debounce(() => post({ type: "setSubtaskText", index: i, text: lb.value }), 250);
    const x = el("span", "x", "✕");
    x.onclick = () => post({ type: "removeSubtask", index: i });
    row.append(box, lb, x);
    list.append(row);
  });

  const add = el("div", "st-add");
  const input = el("input", "ph-in") as HTMLInputElement;
  input.placeholder = "add a subtask…";
  input.dataset["focus"] = "subtask-add";
  input.onkeydown = (e) => {
    if (e.key !== "Enter" || input.value.trim() === "") return;
    post({ type: "addSubtask", text: input.value });
    input.value = ""; // ⏎ keeps the line open.
  };
  add.append(el("span", "box", "☐"), input, el("span", "kbd", "⏎ keeps the line open"));

  const wrap = el("div");
  wrap.append(list, add);
  return field("subtasks", wrap, () => post({ type: "removeField", field: "subtasks" }), "flat · one level · a memory aid, not a plan");
}

function stakeholdersEl(
  shs: { id: string; name: string; direction: "up" | "down" }[],
): HTMLElement {
  const list = el("div", "sh-l");
  for (const sh of shs) {
    const row = el("div", "sh");
    row.append(el("span", "sh-n", sh.name));
    const dir = el("span", "dir");
    const up = el("span", sh.direction === "up" ? "on up" : undefined, "↑ I report to");
    up.onclick = () => post({ type: "setDirection", id: sh.id as never, direction: "up" });
    const dn = el("span", sh.direction === "down" ? "on dn" : undefined, "↓ reports to me");
    dn.onclick = () => post({ type: "setDirection", id: sh.id as never, direction: "down" });
    dir.append(up, dn);
    row.append(dir);
    const x = el("span", "x", "✕");
    x.onclick = () => post({ type: "removeStakeholder", id: sh.id as never });
    row.append(x);
    list.append(row);
  }

  const add = el("div", "st-add");
  const input = el("input", "ph-in") as HTMLInputElement;
  input.placeholder = "add a stakeholder…";
  input.dataset["focus"] = "stakeholder-add";
  input.onkeydown = (e) => {
    if (e.key !== "Enter" || input.value.trim() === "") return;
    // Defaults to ↑: he reports to more people than report to him, and the
    // toggle is right there.
    post({ type: "addStakeholder", name: input.value, direction: "up" });
    input.value = "";
  };
  add.append(el("span", "box", "＋"), input);

  const wrap = el("div");
  wrap.append(list, add);
  return field(
    "stakeholders",
    wrap,
    () => post({ type: "removeField", field: "stakeholders" }),
    "direction is half of urgency",
  );
}

function tagsEl(tags: string[]): HTMLElement {
  const wrap = el("div", "tags");
  for (const t of tags) {
    const chip = el("span", "tag", t);
    const x = el("span", "x", "✕");
    x.onclick = () => post({ type: "removeTag", tag: t });
    chip.append(x);
    wrap.append(chip);
  }
  const input = el("input", "tag-in") as HTMLInputElement;
  input.placeholder = "＋ tag";
  input.dataset["focus"] = "tag-add";
  input.onkeydown = (e) => {
    if (e.key !== "Enter" || input.value.trim() === "") return;
    post({ type: "addTag", tag: input.value });
    input.value = "";
  };
  wrap.append(input);
  return field("tags", wrap, () => post({ type: "removeField", field: "tags" }), "nothing computes from these");
}

function logEl(log: { eventDate: string; message: string }[]): HTMLElement {
  const wrap = el("div");

  const add = el("div", "log-add");
  const date = el("input", "date") as HTMLInputElement;
  date.type = "date";
  date.value = todayISO();
  const txt = el("input", "txt") as HTMLInputElement;
  txt.placeholder = "what happened…";
  txt.dataset["focus"] = "log-add";
  txt.onkeydown = (e) => {
    if (e.key !== "Enter" || txt.value.trim() === "") return;
    post({ type: "addLog", message: txt.value, eventDate: date.value });
    txt.value = "";
  };
  add.append(date, txt, el("span", "kbd", "⏎ logs it"));
  wrap.append(add);

  const list = el("div", "log-l");
  log.forEach((lg, i) => {
    const row = el("div", "lg");
    // The auto-stamp is EDITABLE: he logs Tuesday's event on Friday, and an
    // auto-stamp he cannot correct is a lie in the record.
    const d = el("input", "lg-d") as HTMLInputElement;
    d.type = "date";
    d.value = lg.eventDate;
    d.onchange = () => post({ type: "setLogDate", index: i, eventDate: d.value });
    row.append(d, el("span", "lg-t", lg.message));
    list.append(row);
  });
  wrap.append(list);

  return field("log", wrap, () => post({ type: "removeField", field: "log" }), "newest first");
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function debounce(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

function backlogEl(b: BacklogVm): HTMLElement {
  // The backlog is a fixed action bar over a scrolling shelf. `＋ project` lives
  // in the bar at the TOP (Cédric's call — creating is a top-of-list gesture),
  // and stays visible while the shelf scrolls beneath it.
  const wrap = el("div", "backlog");

  const bar = el("div", "shelf-bar");
  const add = el("button", "depth-b", "＋ project");
  add.title = "add a project";
  add.onclick = () => post({ type: "newProject" });
  bar.append(add);
  wrap.append(bar);

  const shelf = el("div", `shelf scroll${b.drain ? " draining" : ""}`);
  // `bandEl` places the sheet under its own strip. Track whether any band
  // claimed it, so a sheet that matches no row still reaches the screen.
  const claimed =
    b.sheet !== null &&
    b.bands.some((band) =>
      band.strips.some((s) => s.id === b.sheet!.id || s.pips.some((p) => p.id === b.sheet!.id)),
    );
  for (const band of b.bands) {
    shelf.append(bandEl(band, claimed ? b.sheet : null));
    if (band.kind === "unsorted" && b.drain) shelf.append(drainEl(b.drain));
  }
  const sheetPlaced = claimed;
  // The host says a sheet is open, so a sheet MUST be on screen. If it matched
  // no row — a task whose pip is filtered out, a project the shelf did not draw
  // — placing it by flow would silently render nothing, and a click that opens
  // an invisible editor is indistinguishable from a broken click. It goes at the
  // end rather than nowhere.
  if (b.sheet && !sheetPlaced) shelf.append(sheetEl(b.sheet));
  if (b.bands.length === 0) {
    // Not onboarding — a stated fact. He is not a stranger to his own tool, but
    // an empty screen reads as broken, and "empty" and "broken" must not look
    // the same. The chord comes from the host: it is platform-resolved, and
    // `derive/` cannot reach `vscode` to know it.
    // Two roads, and it must say both. Naming only capture was what made the
    // drain feel mandatory on a cold start.
    shelf.append(
      el(
        "div",
        "empty",
        `no projects, no tasks, nothing captured — ${b.captureChord} to capture, or ＋ project above`,
      ),
    );
  }

  wrap.append(shelf);
  return wrap;
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
    // `blocked` is DERIVED, not a status you set — a task is blocked when a
    // person owes it a move (FR-12). Dropping onto it silently did nothing,
    // which read as a broken column. Now the column SAYS it is computed and
    // shows it won't accept a drop, so the refusal is understood, not a bug.
    const computed = col.key === "blocked";
    const c = el("div", `kb-col${computed ? " computed" : ""}`);
    const h = el("div", "kb-col-h");
    h.append(el("span", undefined, col.label), el("b", undefined, String(col.cards.length)));
    if (computed) h.append(el("span", "kb-computed", "computed · depends on a person"));
    c.append(h);

    const list = el("div", "kb-list scroll");
    for (const card of col.cards) list.append(cardEl(card));
    c.append(list);

    // Drag within the single webview only. Cross-tab drag is impossible, so no
    // workflow may assume it.
    c.ondragover = (e) => {
      e.preventDefault();
      // A computed column cannot be a drop target — show the "no" cursor and
      // don't light up as droppable, so the refusal is visible mid-drag.
      if (computed) {
        if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
        c.classList.add("no-drop");
        return;
      }
      c.classList.add("over");
    };
    c.ondragleave = () => c.classList.remove("over", "no-drop");
    c.ondrop = (e) => {
      e.preventDefault();
      c.classList.remove("over", "no-drop");
      const id = e.dataTransfer?.getData("text/plain");
      if (!id) return;
      if (computed) return; // blocked is DERIVED — you cannot drag into it.
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

/**
 * FR-20 — step back through iterations, bounded at six.
 *
 * `‹ older` walks one week back, `newer ›` one forward. At the sixth week the
 * "further" affordance is NOT a seventh week — it is `— export —`, because the
 * honest answer to "older than six" is the data extract, not a deeper view.
 *
 * There is no week picker, no range, no compare toggle here, and adding one is
 * the tripwire: it would make this v1's analytics panel, and the fix would be
 * to delete the stepper, not to keep the control.
 */
function stepperEl(s: ReportVm["stepper"]): HTMLElement {
  const bar = el("div", "step");

  // `older` walks FURTHER BACK, which is a HIGHER offset (+1); `newer` walks
  // toward now, a lower offset (-1). The offset is "weeks ago", so older adds.
  const older = el("button", "step-btn", "‹ older");
  older.disabled = !s.canBack;
  older.onclick = () => post({ type: "stepReport", delta: 1 });

  const label = el("span", "step-wk", s.label);

  const newer = el("button", "step-btn", "newer ›");
  newer.disabled = !s.canForward;
  newer.onclick = () => post({ type: "stepReport", delta: -1 });

  bar.append(older, label, newer);

  // The seventh row. Only offered at the floor — before then, `‹ older` is the
  // road back, and export would be a second way to do a thing there is already
  // a way to do.
  if (s.atFloor) {
    const exportRow = el("button", "step-export", "— export —");
    exportRow.title = "older than six weeks lives in the data extract, not the app";
    exportRow.onclick = () => post({ type: "export" });
    bar.append(exportRow);
  }

  return bar;
}

function reportEl(r: ReportVm): HTMLElement {
  const pg = el("div", "pg scroll");

  pg.append(stepperEl(r.stepper));

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
    "↓ pre-fill lays out the finished work by project — you write the prose after each — .";
  week.append(note);
  pg.append(week);

  const burn = el("div", "pg-sec");
  burn.append(section("③ Burndown", "committed that week, still open"));
  burn.append(burndownEl(r.burndown));
  pg.append(burn);

  // ↓ pre-fill writes the report file laid out by project, then opens it. It
  // never overwrites — an existing file opens as-is (the host guards that).
  const prefillBtn = el("button", "btn pri", "↓ pre-fill report");
  prefillBtn.onclick = () => post({ type: "prefillReport" });
  const openBtn = el("button", "btn", `⧉ open ${r.reportPath}`);
  openBtn.onclick = () => post({ type: "openReport" });
  // FR-17 — the only sharing that exists: the report text, to the clipboard,
  // for an email he sends himself.
  const copyBtn = el("button", "btn", "⧉ copy");
  copyBtn.onclick = () => post({ type: "copyReport" });
  // FR-22 — the raw data, for retrospection he runs himself. Not a chart: a
  // chart is an opinion, and this is the feature that refuses to be v1's panel.
  const exportBtn = el("button", "btn", "⤓ export data");
  exportBtn.onclick = () => post({ type: "export" });
  const foot = el("div", "rp-note foot-actions");
  foot.append(prefillBtn, openBtn, copyBtn, exportBtn);
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
    // No per-line action anymore — the whole report is pre-filled at once,
    // grouped by project. A row here is a reference, read-only.
    row.append(el("span", "rt", r.title), el("span", "rp", r.meta));
    list.append(row);
  }
  if (rows.length === 0) list.append(el("div", "empty", "—"));
  c.append(list);
  return c;
}

/**
 * FR-21 — the burndown, and its fiction FLAGGED.
 *
 * The remaining line is the real, countable one. The ideal is drawn FLAT and
 * dashed and captioned as fiction, because there are no estimates to slope it
 * honestly and a faked slope is the lie the FR forbids. The caption is the
 * feature, not a footnote: a burndown that hides the assumption is v1's chart.
 */
function burndownEl(b: Burndown): HTMLElement {
  const box = el("div", "burn");

  if (b.empty) {
    box.append(el("div", "empty", "nothing committed to this week — nothing to burn down"));
    return box;
  }

  const W = 320;
  const H = 96;
  const padL = 18;
  const padR = 8;
  const padT = 8;
  const padB = 18;
  const days = b.remaining;
  const top = Math.max(b.ideal, 1); // y-axis max; never 0, so the line has room.

  const x = (i: number): number => padL + (i * (W - padL - padR)) / (days.length - 1);
  const y = (v: number): number => padT + (1 - v / top) * (H - padT - padB);

  const chart = svg("svg", { class: "burn-svg", viewBox: `0 0 ${W} ${H}`, width: "100%" });

  // Baseline (zero) and the top gridline — two references, nothing derived.
  chart.append(
    svg("line", { class: "burn-axis", x1: padL, y1: y(0), x2: W - padR, y2: y(0) }),
    svg("line", { class: "burn-grid", x1: padL, y1: y(top), x2: W - padR, y2: y(top) }),
  );

  // The fiction: a flat dashed line at the starting height. Labelled below.
  chart.append(
    svg("line", {
      class: "burn-ideal",
      x1: padL,
      y1: y(b.ideal),
      x2: W - padR,
      y2: y(b.ideal),
    }),
  );

  // The real line: remaining committed, per day.
  const pts = days.map((d, i) => `${x(i)},${y(d.count)}`).join(" ");
  chart.append(svg("polyline", { class: "burn-real", points: pts }));
  days.forEach((d, i) => {
    chart.append(svg("circle", { class: "burn-dot", cx: x(i), cy: y(d.count), r: 2.5 }));
  });

  // y max, so the height is a stated number, not a guess from the pixels.
  const yLabel = svg("text", { class: "burn-ylab", x: 2, y: y(top) + 3 });
  yLabel.textContent = String(top);
  chart.append(yLabel);

  // Day initials, Mon→Sun. The x-axis is the week, stated.
  const initials = ["M", "T", "W", "T", "F", "S", "S"];
  days.forEach((_, i) => {
    const t = svg("text", { class: "burn-xlab", x: x(i), y: H - 6 });
    t.textContent = initials[i] ?? "";
    chart.append(t);
  });

  box.append(chart);

  const legend = el("div", "burn-legend");
  const real = el("span", "burn-leg-real");
  real.append(el("span", "burn-swatch real"), el("span", undefined, "remaining (real)"));
  const ideal = el("span", "burn-leg-ideal");
  ideal.append(el("span", "burn-swatch ideal"), el("span", undefined, b.idealLabel));
  legend.append(real, ideal);
  box.append(legend);

  return box;
}

/**
 * AD-14 — a paint NEVER overwrites the field that currently has focus.
 *
 * Every paint rebuilds the DOM, so without this, saving-as-you-type would rip
 * the input out from under the cursor 250ms after each keystroke. That is v1's
 * focus-loss scar arriving by a new road — v1 replaced its whole HTML on every
 * change and worked around it by persisting focus intent through
 * `vscode.setState`.
 *
 * Text input is the one place the webview leads. Rather than restore focus
 * after the fact, we record where it was and put it back, with the caret where
 * he left it — the render is invisible to him.
 */
function withFocus(paint: () => void): void {
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const key = active?.dataset["focus"];
  const start = active?.selectionStart ?? null;
  const end = active?.selectionEnd ?? null;

  paint();

  if (!key) {
    // Nothing held focus, so nothing is stolen: a sheet that just opened on a
    // born-empty title takes it. `autofocus` is unreliable on a node inserted
    // into an existing document, and this is the layer that owns focus anyway —
    // two mechanisms for one fact is how the caret ends up somewhere surprising.
    const fresh = app.querySelector<HTMLInputElement>('input.ed-title-in[autofocus]');
    if (fresh && fresh.value === "") fresh.focus();
    return;
  }
  const next = app.querySelector<HTMLInputElement>(`[data-focus="${key}"]`);
  if (!next) return;
  next.focus();
  if (start !== null && end !== null && typeof next.setSelectionRange === "function") {
    try {
      next.setSelectionRange(start, end);
    } catch {
      // A date input has no text selection. Focus alone is the win.
    }
  }
}

function render(vm: ViewModel): void {
  withFocus(() => {
    app.replaceChildren();
    app.append(header(vm));

    if (vm.mode === "backlog" && vm.backlog) {
      app.append(ruleBar(vm.backlog.rule), backlogEl(vm.backlog));
    } else if (vm.mode === "kanban" && vm.kanban) {
      app.append(ruleBar(vm.kanban.rule), kanbanEl(vm.kanban));
    } else if (vm.mode === "report" && vm.report) {
      app.append(ruleBar(vm.report.rule), reportEl(vm.report));
    }
  });
}

window.addEventListener("message", (e: MessageEvent<HostMessage>) => {
  if (e.data.type === "render") render(e.data.vm);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // Esc closes whatever is open, sheet before drain. The webview holds no state
  // (AD-11), so the DOM — which is the last VM made visible — is the source of
  // truth: a `.ed` present means a sheet is open. Without the sheet branch, Esc
  // only ever closed the drain and the editor could not be dismissed at all.
  if (app.querySelector(".ed")) post({ type: "closeSheet" });
  else if (app.querySelector(".drain")) post({ type: "closeDrain" });
});

post({ type: "ready" });
