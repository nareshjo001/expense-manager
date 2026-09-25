// Batch 2 architecture closure: proves the actual Mongoose index
"use strict";

const SiaMessage = require("../models/SiaMessage");
const SiaSession = require("../models/SiaSession");
const SiaPreference = require("../models/SiaPreference");

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

describe("models/SiaPreference -- index declarations (SIA-001-T06)", () => {
  it("declares a unique index on userId", () => {
    const indexes = SiaPreference.schema.indexes();
    const userIdIndex = indexes.find(([spec]) => spec.userId === 1);
    expect(userIdIndex).toBeDefined();
    const [, options] = userIdIndex;
    expect(options.unique).toBe(true);
  });
});
