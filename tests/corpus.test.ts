import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalize, priceAnomalies } from "../core/normalize";
test("Corpus versionado: produto principal, variantes, kits, acessório e preço parcial", () => {
  const corpus = JSON.parse(
    readFileSync("tests/fixtures/interpretation-corpus.json", "utf8"),
  ) as {
    cases: {
      title: string;
      description: string;
      model: string;
      storage: number | null;
      partialPrice: boolean;
    }[];
  };
  for (const c of corpus.cases) {
    const p = normalize(c);
    assert.equal(p.model, c.model, c.title);
    assert.equal(p.storage, c.storage, c.title);
    assert.equal(
      priceAnomalies(c.title, c.description).length > 0,
      c.partialPrice,
      c.description,
    );
  }
});
