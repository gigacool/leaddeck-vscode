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
    n.onclick = (e) => {
      e.stopPropagation();
      post({ type: "openSheet", kind: "task", id: p.id });
    };
    return n;
  }
  function stripEl(s) {
    const row = el("div", "strip");
    row.onclick = () => post({ type: "openSheet", kind: "project", id: s.id });
    row.append(el("span", "grip", "\u28FF"), el("span", "p-name", s.title));
    const pips = el("div", "pips");
    for (const p of s.pips) pips.append(pipEl(p));
    row.append(pips);
    const addTask = el("button", "p-add", "\uFF0B");
    addTask.title = "add a task to this project";
    addTask.onclick = (e) => {
      e.stopPropagation();
      post({ type: "newTask", project: s.id });
    };
    row.append(addTask);
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
      row.append(pips, el("span"), el("span"));
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
  function sheetEl(s) {
    const ed = el("div", `ed${s.death ? " dead" : ""}`);
    const h = el("div", "ed-h");
    h.append(el("span", `ed-kind${s.kind === "project" ? " proj" : ""}`, s.kind));
    if (s.crumb) h.append(el("span", "ed-crumb", s.crumb));
    h.append(el("span", "ed-saved", "\u25CF saved"));
    const close = el("button", "ed-close", "esc");
    close.onclick = () => post({ type: "closeSheet" });
    h.append(close);
    ed.append(h);
    const titleRow = el("div", "ed-title");
    const title = el("input", "ed-title-in");
    title.value = s.title;
    title.spellcheck = false;
    title.dataset["focus"] = "title";
    if (s.title === "") {
      title.placeholder = s.kind === "task" ? "what is it?" : "name it";
      title.autofocus = true;
    }
    title.oninput = debounce(() => post({ type: "setTitle", value: title.value }), 250);
    titleRow.append(title);
    if (s.status !== null) {
      const st = el("div", "ed-status");
      for (const v of ["todo", "doing", "done"]) {
        const b = el("span", s.status === v ? `on${v === "done" ? " dn" : ""}` : void 0, v);
        b.onclick = () => post({ type: "setSheetStatus", status: v });
        st.append(b);
      }
      titleRow.append(st);
    } else {
      titleRow.append(el("span", "ed-nostatus", "no todo/doing/done \u2014 a project isn't a task"));
    }
    ed.append(titleRow);
    const sig = el("div", "ed-sig");
    sig.append(el("span", "lbl", "computed"));
    sig.append(el("span", `val${s.signal.kind === "quiet" ? " q" : ""}`, s.signal.text));
    sig.append(el("span", "why", `\u2014 ${s.signalWhy}`));
    sig.append(el("span", "ro", "read-only \xB7 never a control"));
    ed.append(sig);
    const body = el("div", "ed-fields");
    if (s.deadline !== null) {
      body.append(
        field(
          "deadline",
          dateInput(s.deadline, (v) => post({ type: "setDeadline", value: v })),
          () => post({ type: "removeField", field: "deadline" })
        )
      );
    }
    if (s.description !== null) {
      const ta = el("textarea", "inp multi");
      ta.value = s.description.trim();
      ta.rows = 2;
      ta.spellcheck = false;
      ta.dataset["focus"] = "description";
      ta.oninput = debounce(() => post({ type: "setDescription", value: ta.value }), 250);
      body.append(field("description", ta, () => post({ type: "removeField", field: "description" })));
    }
    if (s.commit !== null) {
      const wrap = el("div", "commit");
      const q = el("span", "commit-q");
      q.append(document.createTextNode("In "), el("b", void 0, s.commit.weekOf), document.createTextNode("?"));
      wrap.append(q);
      const t = el("span", "commit-t");
      const yes = el("span", "on", "yes");
      const no = el("span", void 0, "no");
      no.onclick = () => post({ type: "setCommit", weekOf: null });
      t.append(yes, no);
      wrap.append(t);
      body.append(field("the week", wrap, null, "the only judgment you author"));
    }
    if (s.subtasks !== null) body.append(subtasksEl(s.subtasks));
    if (s.stakeholders !== null) body.append(stakeholdersEl(s.stakeholders));
    if (s.tags !== null) body.append(tagsEl(s.tags));
    if (s.log !== null) body.append(logEl(s.log));
    ed.append(body);
    if (s.rail.length > 0) {
      const rail = el("div", "depth");
      rail.append(el("span", "depth-l", "add when you need it"));
      for (const r of s.rail) {
        const b = el("button", "depth-b");
        b.append(document.createTextNode(r.label), el("span", "k", r.chord));
        b.onclick = () => post({ type: "addField", field: r.field });
        rail.append(b);
      }
      if (s.kind === "task" && !s.death) {
        const die = el("button", "depth-b die");
        die.append(document.createTextNode("\u2297 let it die"));
        die.onclick = () => {
          const w = ed.querySelector(".die");
          w?.classList.toggle("open");
        };
        rail.append(die);
      }
      ed.append(rail);
    }
    if (s.kind === "task") {
      const die = el("div", `die${s.death ? " open" : ""}`);
      die.append(el("span", "die-q", s.death ? "died \u2014" : "let it die?"));
      const why = el("div", "why");
      for (const r of ["outdated", "delegated", "cancelled"]) {
        const chip = el("span", s.death?.reason === r ? "on" : void 0, r);
        chip.onclick = () => post({ type: "letItDie", reason: r });
        why.append(chip);
      }
      die.append(why);
      die.append(el("span", "die-note", "the reason is the record \u2014 nothing computes why"));
      if (s.death) {
        const undo = el("button", "btn", "bring it back");
        undo.onclick = () => post({ type: "undie" });
        die.append(undo);
      }
      ed.append(die);
    }
    return ed;
  }
  function field(label2, control, onRemove, note) {
    const fs = el("div", "fs");
    const h = el("div", "fs-h");
    h.append(el("span", "fs-n", label2));
    if (note) h.append(el("span", "fs-w", note));
    if (onRemove) {
      const rm = el("button", "btn ghost", `\u2212 remove ${label2}`);
      rm.onclick = onRemove;
      const a = el("span", "fs-a");
      a.append(rm);
      h.append(a);
    }
    fs.append(h, control);
    return fs;
  }
  function dateInput(value, onChange) {
    const i = el("input", "inp mono");
    i.type = "date";
    i.value = value;
    i.onchange = () => onChange(i.value === "" ? null : i.value);
    return i;
  }
  function subtasksEl(subtasks) {
    const list = el("div", "sub-l");
    subtasks.forEach((st, i) => {
      const row = el("div", `st${st.done ? " dn" : ""}`);
      const box = el("span", `box${st.done ? " on" : ""}`, st.done ? "\u2611" : "\u2610");
      box.onclick = () => post({ type: "toggleSubtask", index: i });
      const lb = el("input", "lb-in");
      lb.value = st.text;
      lb.placeholder = "\u2026";
      lb.dataset["focus"] = `subtask-${i}`;
      lb.oninput = debounce(() => post({ type: "setSubtaskText", index: i, text: lb.value }), 250);
      const x = el("span", "x", "\u2715");
      x.onclick = () => post({ type: "removeSubtask", index: i });
      row.append(box, lb, x);
      list.append(row);
    });
    const add = el("div", "st-add");
    const input = el("input", "ph-in");
    input.placeholder = "add a subtask\u2026";
    input.dataset["focus"] = "subtask-add";
    input.onkeydown = (e) => {
      if (e.key !== "Enter" || input.value.trim() === "") return;
      post({ type: "addSubtask", text: input.value });
      input.value = "";
    };
    add.append(el("span", "box", "\u2610"), input, el("span", "kbd", "\u23CE keeps the line open"));
    const wrap = el("div");
    wrap.append(list, add);
    return field("subtasks", wrap, () => post({ type: "removeField", field: "subtasks" }), "flat \xB7 one level \xB7 a memory aid, not a plan");
  }
  function stakeholdersEl(shs) {
    const list = el("div", "sh-l");
    for (const sh of shs) {
      const row = el("div", "sh");
      row.append(el("span", "sh-n", sh.name));
      const dir = el("span", "dir");
      const up = el("span", sh.direction === "up" ? "on up" : void 0, "\u2191 I report to");
      up.onclick = () => post({ type: "setDirection", id: sh.id, direction: "up" });
      const dn = el("span", sh.direction === "down" ? "on dn" : void 0, "\u2193 reports to me");
      dn.onclick = () => post({ type: "setDirection", id: sh.id, direction: "down" });
      dir.append(up, dn);
      row.append(dir);
      const x = el("span", "x", "\u2715");
      x.onclick = () => post({ type: "removeStakeholder", id: sh.id });
      row.append(x);
      list.append(row);
    }
    const add = el("div", "st-add");
    const input = el("input", "ph-in");
    input.placeholder = "add a stakeholder\u2026";
    input.dataset["focus"] = "stakeholder-add";
    input.onkeydown = (e) => {
      if (e.key !== "Enter" || input.value.trim() === "") return;
      post({ type: "addStakeholder", name: input.value, direction: "up" });
      input.value = "";
    };
    add.append(el("span", "box", "\uFF0B"), input);
    const wrap = el("div");
    wrap.append(list, add);
    return field(
      "stakeholders",
      wrap,
      () => post({ type: "removeField", field: "stakeholders" }),
      "direction is half of urgency"
    );
  }
  function tagsEl(tags) {
    const wrap = el("div", "tags");
    for (const t of tags) {
      const chip = el("span", "tag", t);
      const x = el("span", "x", "\u2715");
      x.onclick = () => post({ type: "removeTag", tag: t });
      chip.append(x);
      wrap.append(chip);
    }
    const input = el("input", "tag-in");
    input.placeholder = "\uFF0B tag";
    input.dataset["focus"] = "tag-add";
    input.onkeydown = (e) => {
      if (e.key !== "Enter" || input.value.trim() === "") return;
      post({ type: "addTag", tag: input.value });
      input.value = "";
    };
    wrap.append(input);
    return field("tags", wrap, () => post({ type: "removeField", field: "tags" }), "nothing computes from these");
  }
  function logEl(log) {
    const wrap = el("div");
    const add = el("div", "log-add");
    const date = el("input", "date");
    date.type = "date";
    date.value = todayISO();
    const txt = el("input", "txt");
    txt.placeholder = "what happened\u2026";
    txt.dataset["focus"] = "log-add";
    txt.onkeydown = (e) => {
      if (e.key !== "Enter" || txt.value.trim() === "") return;
      post({ type: "addLog", message: txt.value, eventDate: date.value });
      txt.value = "";
    };
    add.append(date, txt, el("span", "kbd", "\u23CE logs it"));
    wrap.append(add);
    const list = el("div", "log-l");
    log.forEach((lg, i) => {
      const row = el("div", "lg");
      const d = el("input", "lg-d");
      d.type = "date";
      d.value = lg.eventDate;
      d.onchange = () => post({ type: "setLogDate", index: i, eventDate: d.value });
      row.append(d, el("span", "lg-t", lg.message));
      list.append(row);
    });
    wrap.append(list);
    return field("log", wrap, () => post({ type: "removeField", field: "log" }), "newest first");
  }
  function todayISO() {
    const d = /* @__PURE__ */ new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function debounce(fn, ms) {
    let t;
    return () => {
      if (t) clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }
  function backlogEl(b) {
    const shelf = el("div", `shelf scroll${b.drain ? " draining" : ""}`);
    let sheetPlaced = false;
    for (const band of b.bands) {
      shelf.append(bandEl(band));
      if (band.kind === "unsorted" && b.drain) shelf.append(drainEl(b.drain));
      if (b.sheet && !sheetPlaced) {
        const belongsHere = band.strips.some(
          (s) => s.id === b.sheet.id || s.pips.some((p) => p.id === b.sheet.id)
        );
        if (belongsHere) {
          shelf.append(sheetEl(b.sheet));
          sheetPlaced = true;
        }
      }
    }
    if (b.sheet && !sheetPlaced) shelf.append(sheetEl(b.sheet));
    if (b.bands.length === 0) {
      shelf.append(
        el(
          "div",
          "empty",
          `no projects, no tasks, nothing captured \u2014 ${b.captureChord} to capture, or \uFF0B project below`
        )
      );
    }
    const newRail = el("div", "shelf-rail");
    const add = el("button", "depth-b", "\uFF0B project");
    add.onclick = () => post({ type: "newProject" });
    newRail.append(add);
    shelf.append(newRail);
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
  function withFocus(paint) {
    const active = document.activeElement;
    const key = active?.dataset["focus"];
    const start = active?.selectionStart ?? null;
    const end = active?.selectionEnd ?? null;
    paint();
    if (!key) {
      const fresh = app.querySelector("input.ed-title-in[autofocus]");
      if (fresh && fresh.value === "") fresh.focus();
      return;
    }
    const next = app.querySelector(`[data-focus="${key}"]`);
    if (!next) return;
    next.focus();
    if (start !== null && end !== null && typeof next.setSelectionRange === "function") {
      try {
        next.setSelectionRange(start, end);
      } catch {
      }
    }
  }
  function render(vm) {
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
  window.addEventListener("message", (e) => {
    if (e.data.type === "render") render(e.data.vm);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") post({ type: "closeDrain" });
  });
  post({ type: "ready" });
})();
//# sourceMappingURL=main.js.map
