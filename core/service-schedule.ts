/** Conservative cadence: requested interval cannot imply more daily capacity than configured. */
export function plannedInterval(
  requested: number,
  planMinimum: number,
  daily: number,
  radars: number,
  globalDaily = daily,
  globalRadars = radars,
) {
  return Math.max(
    requested,
    planMinimum,
    daily > 0 ? Math.ceil((86400 * Math.max(1, radars)) / daily) : 86400,
    globalDaily > 0
      ? Math.ceil((86400 * Math.max(1, globalRadars)) / globalDaily)
      : 86400,
  );
}
export function intervalLabel(seconds: number) {
  const minutes = Math.ceil(seconds / 60),
    hours = Math.floor(minutes / 60),
    days = Math.floor(hours / 24);
  if (days)
    return `${days} dia${days === 1 ? "" : "s"}${hours % 24 ? ` e ${hours % 24} h` : ""}`;
  if (hours) return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  return `${minutes} minutos`;
}
