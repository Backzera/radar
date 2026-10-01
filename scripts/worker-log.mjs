// Whitelist operational fields. Never print response payloads or credentials.
export function cleanWorkerText(value, secrets = [], max = 500) {
  if (typeof value !== "string") return null;
  let text = value.slice(0, 4000);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4)
      text = text.split(secret).join("[segredo omitido]");
  }
  return text
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [omitido]")
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|worker[_-]?token|secret|password|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi,
      "credencial=[omitida]",
    )
    .replace(/https?:\/\/[^\s<>]+/gi, "[URL omitida]")
    .replace(/\b[A-Za-z0-9_+/=-]{40,}\b/g, "[valor omitido]")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .slice(0, max);
}
export function workerJobLogs(result, secrets = []) {
  if (!result || typeof result !== "object") return [];
  const rows = Array.isArray(result.results)
    ? result.results.slice(0, 10)
    : [result];
  return rows
    .filter((row) => row && typeof row === "object" && (row.jobId || row.error))
    .map((row) => ({
      event: row.error ? "worker_job_error" : "worker_job",
      status: cleanWorkerText(row.status, secrets, 40),
      jobId: cleanWorkerText(row.jobId, secrets, 200),
      snapshotId: cleanWorkerText(row.snapshotId, secrets, 200),
      received: Number.isFinite(row.received) ? row.received : null,
      phase: ["preflight", "trigger", "poll"].includes(row.phase)
        ? row.phase
        : null,
      error: cleanWorkerText(row.error, secrets),
      retrySeconds: Number.isFinite(row.retrySeconds) ? row.retrySeconds : null,
    }));
}
