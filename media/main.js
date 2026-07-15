"use strict";
(() => {
  // src/surface/webview/main.ts
  var vscode = acquireVsCodeApi();
  var post = (m) => vscode.postMessage(m);
  var app = document.getElementById("app");
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== void 0) n.textContent = text;
    return n;
  }
  function header(vm) {
    const head = el("div", "wb-head");
    const seg = el("div", "seg");
    for (const mode of ["backlog", "kanban", "report"]) {
      const b = el("button", vm.mode === mode ? "on" : void 0, label(mode));
      b.onclick = () => post({ type: "setMode", mode });
      seg.append(b);
    }
    head.append(seg);
    const root = el("div", `wb-root${vm.rootKind === "local" ? " local" : ""}`);
    root.textContent = vm.rootKind === "local" ? ".leaddeck (local)" : vm.root;
    root.title = vm.root;
    head.append(root);
    return head;
  }
  var label = (m) => m.charAt(0).toUpperCase() + m.slice(1);
  function ruleBar(text) {
    const r = el("div", "rule");
    r.append(el("span", "lbl", "rule"), el("span", void 0, text));
    return r;
  }
  function pipEl(p) {
    const n = el("span", `pip ${p.state}${p.wk ? " wk" : ""}`);
    n.title = p.title;
    return n;
  }
  function stripEl(s) {
    const row = el("div", "strip");
    row.append(el("span", "grip", "\u28FF"), el("span", "p-name", s.title));
    const pips = el("div", "pips");
    for (const p of s.pips) pips.append(pipEl(p));
    row.append(pips);
    const right = el("div", "p-right");
    right.append(el("span", "frac", `${s.done}/${s.total}`));
    right.append(el("span", `sig ${s.signal.tone}`, s.signal.text));
    const who = el("span", "who");
    if (s.who) {
      const g = el("span", s.who.glyph === "\u2191" ? "up" : "down", `${s.who.glyph} ${s.who.label}`);
      who.append(g);
    } else {
      who.append(el("span", "none", "\u2014"));
    }
    right.append(who);
    row.append(right);
    return row;
  }
  function bandEl(b) {
    const band = el("div", `band ${b.kind}`);
    const h = el("div", "band-h");
    h.append(el("span", "band-name", b.label), el("span", "band-why", b.predicate));
    const n = el("span", "band-n");
    if (b.kind === "unsorted") {
      const age = b.oldestCaptureDays !== null ? ` \xB7 oldest ${b.oldestCaptureDays}d` : "";
      n.textContent = `${b.count} unsorted${age}`;
      h.onclick = () => post({ type: "openDrain" });
    } else {
      n.textContent = String(b.count);
    }
    h.append(n);
    band.append(h);
    if (b.kind === "unsorted" && b.captures.length > 0) {
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
  function drainEl(d) {
    const wrap = el("div", "drain");
    const top = el("div", "drain-top");
    top.append(el("span", "drain-q", "what is this?"));
    const count = el("span", "drain-count");
    count.append(el("b", void 0, String(d.captures.length)), document.createTextNode(" left"));
    top.append(count);
    wrap.append(top);
    const list = el("div", "drain-list");
    for (const c of d.captures) {
      const row = el("div", "dc");
      row.append(el("span", "txt", c.text));
      row.append(el("span", "when", c.ageDays === 0 ? "today" : `${c.ageDays}d`));
      const acts = el("div", "acts");
      const task = el("button", "btn pri", "\u2192 task");
      task.onclick = () => post({ type: "resolveCapture", id: c.id, to: "task" });
      const project = el("button", "btn", "\u2192 project");
      project.title = "it is not a task \u2014 it is a whole thing";
      project.onclick = () => post({ type: "resolveCapture", id: c.id, to: "project" });
      const bin = el("button", "btn death", "let it die");
      bin.onclick = () => post({ type: "resolveCapture", id: c.id, to: "bin", reason: "outdated" });
      acts.append(task, project, bin);
      row.append(acts);
      list.append(row);
    }
    wrap.append(list);
    const foot = el("div", "drain-foot");
    foot.append(el("span", void 0, "resolve any, in any order \u2014 leaving some is fine"));
    const esc = el("button", "btn esc", "Esc \u2014 stop");
    esc.onclick = () => post({ type: "closeDrain" });
    foot.append(esc);
    wrap.append(foot);
    return wrap;
  }
  function backlogEl(b) {
    const shelf = el("div", `shelf scroll${b.drain ? " draining" : ""}`);
    for (const band of b.bands) {
      shelf.append(bandEl(band));
      if (band.kind === "unsorted" && b.drain) shelf.append(drainEl(b.drain));
    }
    if (b.bands.length === 0) {
      shelf.append(
        el("div", "empty", `no projects, no tasks, nothing captured \u2014 ${b.captureChord} to capture`)
      );
    }
    return shelf;
  }
  function cardEl(c) {
    const t = el("div", `t ${c.tone}${c.done ? " done" : ""}`);
    t.draggable = true;
    t.dataset["id"] = c.id;
    t.append(el("div", "t-title", c.title));
    const meta = el("div", "t-meta");
    meta.append(el("span", void 0, c.project), el("span", `sig ${c.signal.tone}`, c.signal.text));
    t.append(meta);
    t.ondragstart = (e) => {
      e.dataTransfer?.setData("text/plain", c.id);
      t.classList.add("dragging");
    };
    t.ondragend = () => t.classList.remove("dragging");
    return t;
  }
  function kanbanEl(k) {
    const kb = el("div", "kb");
    for (const col of k.columns) {
      const c = el("div", "kb-col");
      const h = el("div", "kb-col-h");
      h.append(el("span", void 0, col.label), el("b", void 0, String(col.cards.length)));
      c.append(h);
      const list = el("div", "kb-list scroll");
      for (const card of col.cards) list.append(cardEl(card));
      c.append(list);
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
        if (col.key === "blocked") return;
        const status = col.key === "done" ? "done" : col.key === "doing" ? "doing" : "todo";
        post({ type: "setStatus", id, status });
      };
      kb.append(c);
    }
    return kb;
  }
  function section(name, note) {
    const h = el("div", "pg-sec-h");
    h.append(el("span", "pg-sec-n", name), el("span", "pg-sec-w", note));
    return h;
  }
  function reportEl(r) {
    const pg = el("div", "pg scroll");
    const risk = el("div", "pg-sec");
    risk.append(section("\u2460 At risk", "what needs a decision"));
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
    week.append(section("\u2461 The week", r.week));
    const three = el("div", "rp3");
    three.append(
      column("done", "What happened", r.happened.map((h) => ({ id: h.id, title: h.title, meta: h.project }))),
      column("stuck", "Where I'm stuck", r.stuck.map((s) => ({ id: s.id, title: s.title, meta: s.why }))),
      column("next", "Next", r.next.map((n) => ({ id: n.id, title: n.title, meta: n.project })))
    );
    week.append(three);
    const note = el("div", "rp-note");
    note.textContent = "\u27E8 pull \u27E9 inserts a stub \u2014 a title and a cursor. The sentence is yours; the app cannot write it.";
    week.append(note);
    pg.append(week);
    const openBtn = el("button", "btn", `\u29C9 open ${r.reportPath}`);
    openBtn.onclick = () => post({ type: "openReport" });
    const foot = el("div", "rp-note");
    foot.append(openBtn);
    pg.append(foot);
    return pg;
  }
  function column(kind, name, rows) {
    const c = el("div", `rp3-c ${kind}`);
    const h = el("div", "rp3-h");
    h.append(el("span", "rp3-n", name), el("span", "rp3-b", String(rows.length)));
    c.append(h);
    const list = el("div", "rp3-l");
    for (const r of rows) {
      const row = el("div", "ri");
      row.append(el("span", "rt", r.title), el("span", "rp", r.meta));
      const add = el("button", "add", "\u27E8 pull \u27E9");
      add.onclick = () => post({ type: "pull", id: r.id });
      row.append(add);
      list.append(row);
    }
    if (rows.length === 0) list.append(el("div", "empty", "\u2014"));
    c.append(list);
    return c;
  }
  function render(vm) {
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
  window.addEventListener("message", (e) => {
    if (e.data.type === "render") render(e.data.vm);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") post({ type: "closeDrain" });
  });
  post({ type: "ready" });
})();
//# sourceMappingURL=main.js.map
