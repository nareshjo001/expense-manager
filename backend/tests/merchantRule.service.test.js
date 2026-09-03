// CAT-001 -- backend/Services/CategorizationServices/merchantRule.service.js
"use strict";

const MODEL_PATH = "../models/MerchantCategoryRule";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const OTHER_USER_ID = "64f1a2b3c4d5e6f7a8b9c0bb";

// A stateful, in-memory stand-in for the real Mongoose model -- keyed by
// {userId, merchantKey} to mirror the real unique index's semantics.
function makeFakeModel() {
  const store = new Map(); // `${userId}:${merchantKey}` -> doc
  let idCounter = 0;

  const chainable = (result) => ({ lean: async () => result });

  return {
    __store: store,
    findOne: jest.fn(({ userId, merchantKey }) => chainable(store.get(`${userId}:${merchantKey}`) || null)),
    find: jest.fn(({ userId }) => {
      const results = [...store.values()].filter((d) => String(d.userId) === String(userId));
      return {
        sort: () => chainable([...results].sort((a, b) => b.updatedAt - a.updatedAt)),
      };
    }),
    findOneAndUpdate: jest.fn(({ userId, merchantKey }, update) => {
      const key = `${userId}:${merchantKey}`;
      const existing = store.get(key);
      const doc = existing
        ? { ...existing, category: update.$set.category, updatedAt: new Date() }
        : { _id: `rule-${++idCounter}`, userId, merchantKey, category: update.$set.category, updatedAt: new Date() };
      store.set(key, doc);
      return chainable(doc);
    }),
    findOneAndDelete: jest.fn(async ({ _id, userId }) => {
      for (const [key, doc] of store.entries()) {
        if (doc._id === _id && String(doc.userId) === String(userId)) {
          store.delete(key);
          return doc;
        }
      }
      return null;
    }),
  };
}

function loadService(fakeModel) {
  jest.resetModules();
  jest.doMock(MODEL_PATH, () => fakeModel);
  return require("../Services/CategorizationServices/merchantRule.service");
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("upsertRule", () => {
  test("creates a new rule with normalized merchant key and category", async () => {
    const model = makeFakeModel();
    const { upsertRule } = loadService(model);

    const rule = await upsertRule(USER_ID, "  Starbucks Coffee  ", "food");

    expect(rule.merchantKey).toBe("starbucks coffee");
    expect(rule.category).toBe("Food");
  });

  test("a second save for the same merchant replaces the category rather than creating a duplicate", async () => {
    const model = makeFakeModel();
    const { upsertRule, listRules } = loadService(model);

    await upsertRule(USER_ID, "Starbucks", "food");
    await upsertRule(USER_ID, "STARBUCKS", "Entertainment");

    const rules = await listRules(USER_ID);
    expect(rules).toHaveLength(1);
    expect(rules[0].category).toBe("Entertainment");
  });

  test("rejects a missing/unusable merchant name", async () => {
    const model = makeFakeModel();
    const { upsertRule, MerchantRuleValidationError } = loadService(model);

    await expect(upsertRule(USER_ID, "   ", "Food")).rejects.toBeInstanceOf(MerchantRuleValidationError);
  });

  test("rejects a missing/invalid category", async () => {
    const model = makeFakeModel();
    const { upsertRule, MerchantRuleValidationError } = loadService(model);

    await expect(upsertRule(USER_ID, "Starbucks", "")).rejects.toBeInstanceOf(MerchantRuleValidationError);
  });
});

describe("findRuleForMerchant", () => {
  test("finds a rule regardless of the query text's casing/whitespace", async () => {
    const model = makeFakeModel();
    const { upsertRule, findRuleForMerchant } = loadService(model);

    await upsertRule(USER_ID, "Starbucks Coffee", "Food");
    const found = await findRuleForMerchant(USER_ID, "  STARBUCKS   coffee ");

    expect(found.category).toBe("Food");
  });

  test("returns null for a merchant with no rule, without throwing", async () => {
    const model = makeFakeModel();
    const { findRuleForMerchant } = loadService(model);

    await expect(findRuleForMerchant(USER_ID, "Unrelated Merchant")).resolves.toBeNull();
  });

  test("returns null for unusable input rather than throwing", async () => {
    const model = makeFakeModel();
    const { findRuleForMerchant } = loadService(model);

    await expect(findRuleForMerchant(USER_ID, "")).resolves.toBeNull();
    await expect(findRuleForMerchant(USER_ID, undefined)).resolves.toBeNull();
  });

  test("never returns another user's rule for the same merchant text", async () => {
    const model = makeFakeModel();
    const { upsertRule, findRuleForMerchant } = loadService(model);

    await upsertRule(OTHER_USER_ID, "Starbucks", "Entertainment");

    await expect(findRuleForMerchant(USER_ID, "Starbucks")).resolves.toBeNull();
  });
});

describe("deleteRule", () => {
  test("deletes a rule owned by the requesting user", async () => {
    const model = makeFakeModel();
    const { upsertRule, deleteRule, listRules } = loadService(model);

    const rule = await upsertRule(USER_ID, "Starbucks", "Food");
    const deleted = await deleteRule(USER_ID, rule._id);

    expect(deleted).toBe(true);
    expect(await listRules(USER_ID)).toHaveLength(0);
  });

  test("never deletes another user's rule, even with the correct ruleId", async () => {
    const model = makeFakeModel();
    const { upsertRule, deleteRule, listRules } = loadService(model);

    const rule = await upsertRule(OTHER_USER_ID, "Starbucks", "Food");
    const deleted = await deleteRule(USER_ID, rule._id);

    expect(deleted).toBe(false);
    expect(await listRules(OTHER_USER_ID)).toHaveLength(1);
  });

  test("returns false for a nonexistent ruleId rather than throwing", async () => {
    const model = makeFakeModel();
    const { deleteRule } = loadService(model);

    await expect(deleteRule(USER_ID, "nonexistent-id")).resolves.toBe(false);
  });
});
