// Batch 2 architecture closure: proves the actual Mongoose index
// declarations on SiaSession/SiaMessage -- introspected directly via
// `schema.indexes()`, which works without a live database connection
// (index specs are just schema metadata until a real connection
// `syncIndexes()`s them).
"use strict";

const SiaMessage = require("../models/SiaMessage");
const SiaSession = require("../models/SiaSession");

describe("models/SiaMessage -- index declarations", () => {
  it("declares a unique, sparse index on (session, clientMessageId)", () => {
    const indexes = SiaMessage.schema.indexes();
    const idempotencyIndex = indexes.find(([spec]) => "session" in spec && "clientMessageId" in spec);

    expect(idempotencyIndex).toBeDefined();
    const [spec, options] = idempotencyIndex;
    expect(spec).toEqual({ session: 1, clientMessageId: 1 });
    expect(options.unique).toBe(true);
    expect(options.sparse).toBe(true);
  });

  it("declares a pagination-supporting index on (session, createdAt)", () => {
    const indexes = SiaMessage.schema.indexes();
    const paginationIndex = indexes.find(
      ([spec]) => spec.session === 1 && spec.createdAt === 1
    );
    expect(paginationIndex).toBeDefined();
  });
});

describe("models/SiaSession -- index declarations", () => {
  it("declares a session-listing index on (user, updatedAt)", () => {
    const indexes = SiaSession.schema.indexes();
    const listingIndex = indexes.find(([spec]) => spec.user === 1 && spec.updatedAt === -1);
    expect(listingIndex).toBeDefined();
  });
});
