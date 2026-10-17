// Uso ilimitado: o usuário pode buscar quantas vezes quiser. O sistema de cota
// diária continua existindo no código (para um eventual plano futuro), mas o
// limite padrão é tão alto que, na prática, não há limite. Um administrador pode
// reintroduzir um teto definindo MAX_DAILY_PROVIDER_TRIGGERS, se um dia quiser.
export const UNLIMITED_DAILY_TRIGGERS = 1_000_000;
export const isUnlimitedTriggers = (n: number) =>
  n >= UNLIMITED_DAILY_TRIGGERS;
