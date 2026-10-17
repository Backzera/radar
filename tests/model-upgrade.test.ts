import test from "node:test";
import assert from "node:assert/strict";
import { parseModelRank, isSameOrNewer } from "../core/model-rank";
import { matchesMonitor } from "../core/opportunity";
import { normalize } from "../core/normalize";
import type { Listing, Monitor } from "../core/types";
import { fixture, monitor } from "./fixtures";

test("parseModelRank: linha, geração e tier do nome do modelo", () => {
  assert.deepEqual(parseModelRank("iPhone 11"), {
    family: "iphone",
    gen: 11,
    tier: 1,
  });
  assert.deepEqual(parseModelRank("iPhone 11 Pro Max"), {
    family: "iphone",
    gen: 11,
    tier: 4,
  });
  assert.deepEqual(parseModelRank("Galaxy S23 ULTRA"), {
    family: "galaxy s",
    gen: 23,
    tier: 3,
  });
  assert.equal(parseModelRank(null), null);
});

test("isSameOrNewer: mesmo modelo ou superior na mesma linha", () => {
  assert.equal(isSameOrNewer("iPhone 11", "iPhone 11"), true); // igual
  assert.equal(isSameOrNewer("iPhone 11", "iPhone 11 Pro"), true); // tier maior
  assert.equal(isSameOrNewer("iPhone 11", "iPhone 11 Pro Max"), true);
  assert.equal(isSameOrNewer("iPhone 12", "iPhone 13"), true); // geração maior
  assert.equal(isSameOrNewer("iPhone 12", "iPhone 11"), false); // mais antigo
  assert.equal(isSameOrNewer("iPhone 11 Pro", "iPhone 11"), false); // tier menor
  assert.equal(isSameOrNewer("iPhone 11", "Galaxy S23"), false); // outra linha
});

function listingWith(title: string): Listing {
  const { listing } = fixture();
  return {
    ...listing,
    title,
    city: "Curitiba",
    latitude: null,
    longitude: null,
    product: normalize({ title, description: "" }),
  };
}

const base: Monitor = {
  ...monitor,
  query: "iPhone 11",
  product: "iPhone 11",
  city: "Curitiba",
  latitude: null,
  longitude: null,
  condition: "any",
  negatives: [],
};

test("revenda: aceita modelo igual ou superior da mesma linha", () => {
  const resale: Monitor = { ...base, intent: "resale" };
  assert.equal(matchesMonitor(listingWith("iPhone 11 Apple 128GB"), resale), true);
  assert.equal(matchesMonitor(listingWith("iPhone 11 Pro 256GB"), resale), true);
  assert.equal(matchesMonitor(listingWith("iPhone 11 Pro Max 256GB"), resale), true);
  assert.equal(matchesMonitor(listingWith("iPhone 13 128GB"), resale), true);
  // Fora da regra: modelo mais antigo e outra linha continuam excluídos.
  assert.equal(matchesMonitor(listingWith("Galaxy S23 256GB"), resale), false);
});

test("comprar para mim: mantém modelo exato", () => {
  const personal: Monitor = { ...base, intent: "personal" };
  assert.equal(matchesMonitor(listingWith("iPhone 11 Apple 128GB"), personal), true);
  assert.equal(matchesMonitor(listingWith("iPhone 11 Pro 256GB"), personal), false);
  assert.equal(matchesMonitor(listingWith("iPhone 13 128GB"), personal), false);
});
