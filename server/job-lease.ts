import type { Database } from "./store";

export class LeaseLost extends Error {
  constructor() {
    super("Execução assumida por outro worker");
  }
}

// Fence every write in the same D1 transaction as its ownership check.
// SELECT json rejects the transaction if the lease is no longer ours; it makes
// no changes itself. Reads use the original statement, writes use run/batch.
export function jobLease(db: Database, id: string, token: string) {
  const statements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const owns = async () =>
    !!(await db
      .prepare(
        "SELECT id FROM jobs WHERE id=? AND status='running' AND lease_token=? AND lease_until>?",
      )
      .bind(id, token, new Date().toISOString())
      .first());
  const fencedBatch = async <T = unknown>(
    input: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> => {
    const fence = db
      .prepare(
        "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE id=? AND status='running' AND lease_token=? AND lease_until>?) THEN '{}' ELSE 'lease_lost' END)",
      )
      .bind(id, token, new Date().toISOString());
    try {
      return (
        await db.batch<T>([fence, ...input.map((s) => statements.get(s) ?? s)])
      ).slice(1);
    } catch (error) {
      if (!(await owns())) throw new LeaseLost();
      throw error;
    }
  };
  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    const wrapped = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      first: statement.first.bind(statement),
      all: statement.all.bind(statement),
      raw: statement.raw?.bind(statement),
      run: async () => (await fencedBatch([statement]))[0],
    } as D1PreparedStatement;
    statements.set(wrapped, statement);
    return wrapped;
  }
  return {
    db: {
      prepare: (sql: string) => wrap(db.prepare(sql)),
      batch: fencedBatch,
    } as Database,
    async renew() {
      const now = new Date();
      const result = await db
        .prepare(
          "UPDATE jobs SET lease_until=? WHERE id=? AND status='running' AND lease_token=? AND lease_until>?",
        )
        .bind(
          new Date(+now + 120000).toISOString(),
          id,
          token,
          now.toISOString(),
        )
        .run();
      if (!result.meta.changes) throw new LeaseLost();
    },
  };
}
