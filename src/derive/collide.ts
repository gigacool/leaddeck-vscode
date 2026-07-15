import type { Day, Dataset, Project } from "../model/types.ts";
import { urgencyOf, type UrgencySignal } from "./urgency.ts";

/**
 * Collision surfacing — "a search you didn't ask for".
 *
 * The duplicate problem is not a search problem. Duplicates are born in a
 * two-second window with NO TIME TO SEARCH: someone is mid-sentence at his desk.
 * Better ranking cannot help, because he was never going to invoke a search.
 *
 * So the match arrives before the word is finished, unasked. Typing
 * `helvetia leg` surfaces `Bid: legal sign-off on SLA — Helvetia · blocked 9d`.
 * The duplicate cannot happen — not because he was disciplined, but because the
 * collision arrived first.
 *
 * Pure (AD-3). The QuickPick's own filter is defeated with `alwaysShow: true`
 * in `surface/`, so this ranking is authoritative for MEMBERSHIP.
 */

export interface Collision {
  kind: "task" | "project";
  id: string;
  title: string;
  /** The project a task sits in. Empty for a project row. */
  context: string;
  signal: UrgencySignal | null;
  score: number;
}

const MAX_HITS = 6;

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * Every query token must hit something — prefix counts, because the whole point
 * is matching before the word is finished.
 */
function scoreTokens(queryTokens: string[], targetTokens: string[]): number | null {
  if (queryTokens.length === 0) return null;
  let score = 0;
  for (const q of queryTokens) {
    let best = 0;
    for (const t of targetTokens) {
      if (t === q) best = Math.max(best, 3);
      else if (t.startsWith(q)) best = Math.max(best, 2);
      else if (q.length >= 3 && t.includes(q)) best = Math.max(best, 1);
    }
    if (best === 0) return null;
    score += best;
  }
  return score;
}

export function collide(query: string, data: Dataset, now: Day): Collision[] {
  const q = tokens(query);
  if (q.length === 0) return [];

  const projectTitle = new Map<string, string>(
    data.projects.map((p: Project) => [p.id, p.title]),
  );

  const hits: Collision[] = [];

  for (const task of data.tasks) {
    if (task.death !== null) continue;
    const context = projectTitle.get(task.project) ?? "";
    // The project name is part of the target: "helvetia leg" should find a task
    // titled "legal sign-off" inside the Helvetia project.
    const score = scoreTokens(q, [
      ...tokens(task.title),
      ...tokens(context),
      ...task.tags.flatMap(tokens),
    ]);
    if (score === null) continue;
    hits.push({
      kind: "task",
      id: task.id,
      title: task.title,
      context,
      signal: urgencyOf(task, data, now),
      score: score + (task.status === "done" ? -2 : 0),
    });
  }

  for (const project of data.projects) {
    const score = scoreTokens(q, [...tokens(project.title), ...project.tags.flatMap(tokens)]);
    if (score === null) continue;
    hits.push({
      kind: "project",
      id: project.id,
      title: project.title,
      context: "",
      signal: null,
      score,
    });
  }

  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, MAX_HITS);
}

/** Tasks first, then projects — the same order the QuickPick renders them in. */
export function splitCollisions(hits: Collision[]): {
  tasks: Collision[];
  projects: Collision[];
} {
  return {
    tasks: hits.filter((h) => h.kind === "task"),
    projects: hits.filter((h) => h.kind === "project"),
  };
}
