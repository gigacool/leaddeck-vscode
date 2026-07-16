import type { ReportVm } from "../model/protocol.ts";
import type { Week } from "../model/types.ts";

/**
 * The report file, PRE-FILLED from the week's material, grouped by project.
 *
 * This reverses FR-18's old law ("pull inserts a stub, never a sentence").
 * Cédric's own words at the first real run: retyping task titles one by one was
 * friction with no payoff — the useful friction is WRITING THE PROSE, and that
 * stays. So the app lays out every finished task under `What happened`, grouped
 * by project, each on its own line with a trailing ` — ` where he writes. He
 * works project by project, as he asked; the app does the copying, he does the
 * thinking.
 *
 * It is pure text derived from the in-memory `ReportVm` — the same three lists
 * the screen shows, so the file can never disagree with the screen. AD-9 still
 * holds: this is generated FROM memory and written ONCE at creation; the app
 * never reads the file back.
 */
export function reportSkeleton(r: ReportVm, week: Week): string {
  const lines: string[] = [`# ${week}`, ""];

  lines.push("## What happened", "");
  lines.push(...byProject(r.happened));
  lines.push("");

  lines.push("## Where I'm stuck", "");
  lines.push(...byProject(r.stuck));
  lines.push("");

  lines.push("## Next week", "");
  lines.push(...byProject(r.next));
  lines.push("");

  return lines.join("\n");
}

/**
 * Group rows under `### Project` headings, in first-seen order, each task a
 * `- title — ` line ending in the em-dash-and-space he writes after. An empty
 * section gets a quiet placeholder, not a bare heading that looks like a bug.
 */
function byProject(rows: { title: string; project: string }[]): string[] {
  if (rows.length === 0) return ["_(nothing this week)_"];

  const order: string[] = [];
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.project || "Inbox";
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(`- ${row.title} — `);
  }

  const out: string[] = [];
  for (const project of order) {
    out.push(`### ${project}`, ...groups.get(project)!, "");
  }
  // Drop the trailing blank the loop leaves, so sections space evenly.
  if (out.at(-1) === "") out.pop();
  return out;
}
