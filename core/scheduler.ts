export function nextInterval(
  base: number,
  freshResults: number,
  errorCount = 0,
  random = Math.random,
): number {
  const adaptive = freshResults === 0 ? base * 1.25 : base;
  return Math.round(
    Math.min(3600, Math.max(60, adaptive) * 2 ** Math.min(errorCount, 5)) *
      (1 + random() * 0.15),
  );
}
export function retryDelay(
  attempt: number,
  retryAfterSeconds: number | null = null,
  random = Math.random,
): number {
  return Math.max(
    retryAfterSeconds ?? 0,
    Math.min(1800, 15 * 2 ** Math.min(attempt, 7)) + Math.floor(random() * 15),
  );
}
export function selectQueries(
  queries: { text: string; runs: number; discoveries: number }[],
  limit = 3,
): string[] {
  // Exploration bonus keeps untried aliases useful without an unbounded query explosion.
  return [...queries]
    .sort(
      (a, b) =>
        (b.discoveries + 2) / (b.runs + 1) - (a.discoveries + 2) / (a.runs + 1),
    )
    .slice(0, Math.min(6, limit))
    .map((q) => q.text);
}
