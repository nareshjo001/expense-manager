// REC-001-T04 -- item-level claim semantics for the push-retry loop.
//
// The property under test is the one the job-level lease alone could never
// give: even if TWO workers run this loop at the same time (Redis outage,
// lease expiry mid-run, a manual invocation racing the cron), a single
// notification is sent AT MOST ONCE. The claim is a compare-and-swap on
// retryCount, so the loser's filter stops matching and it skips the item.
"use strict";

const RETRY_PUSH_PATH = "../cron/retryPush";
const NOTIFICATION_PATH = "../models/Notification";
const PUSH_SERVICE_PATH = "../Services/push.service";
const CRON_PATH = "node-cron";
const LEASE_PATH = "../utils/jobLease";

// A minimal in-memory stand-in for the one Mongo behaviour this design
// depends on: findOneAndUpdate matching and updating a document ATOMICALLY.
// The store applies each call to completion before the next one observes the
// document, which is exactly the guarantee a single-document update gives.
function buildStore(docs) {
  const state = docs.map((d) => ({ ...d }));

  const matches = (doc, filter) => {
    if (String(doc._id) !== String(filter._id)) return false;
    if (filter.pushStatus !== undefined && doc.pushStatus !== filter.pushStatus) return false;
    if (filter.retryCount !== undefined && doc.retryCount !== filter.retryCount) return false;
    if (filter.nextRetryAt && filter.nextRetryAt.$lte !== undefined) {
      if (doc.nextRetryAt === null || doc.nextRetryAt === undefined) return false;
      if (new Date(doc.nextRetryAt) > new Date(filter.nextRetryAt.$lte)) return false;
    }
    return true;
  };

  return {
    state,
    find: jest.fn(async () => state.filter((d) => d.pushStatus === "failed" && d.retryCount < 3).map((d) => ({ ...d }))),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const doc = state.find((d) => matches(d, filter));
      if (!doc) return null;
      if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] += v;
      if (update.$set) for (const [k, v] of Object.entries(update.$set)) doc[k] = v;
      return { ...doc };
    }),
    updateOne: jest.fn(async (filter, update) => {
      const doc = state.find((d) => String(d._id) === String(filter._id));
      if (doc) Object.assign(doc, update);
      return { acknowledged: true };
    }),
  };
}

function loadJob({ docs, sendImpl }) {
  jest.resetModules();

  const store = buildStore(docs);
  const sendPush = jest.fn(sendImpl || (async () => ({ success: true })));
  const scheduled = {};

  jest.doMock(CRON_PATH, () => ({
    schedule: (expr, handler) => {
      scheduled.handler = handler;
      return { stop: () => {} };
    },
  }));
  jest.doMock(NOTIFICATION_PATH, () => store);
  jest.doMock(PUSH_SERVICE_PATH, () => ({ sendPush }));
  // The lease is not under test here; run the body directly.
  jest.doMock(LEASE_PATH, () => ({
    runWithLease: async (_name, _ttl, fn) => {
      await fn({ isHeld: () => true });
      return { ran: true };
    },
  }));

  require(RETRY_PUSH_PATH);
  return { store, sendPush, run: () => scheduled.handler() };
}

const NOW_PAST = new Date(Date.now() - 60_000);

const notif = (id) => ({
  _id: id,
  userId: `user-${id}`,
  title: "t",
  message: "m",
  pushStatus: "failed",
  retryCount: 0,
  nextRetryAt: NOW_PAST,
});

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("retryPush -- item-level claim (REC-001-T04)", () => {
  test("sends each eligible notification exactly once in a single run", async () => {
    const { sendPush, run, store } = loadJob({ docs: [notif("a"), notif("b")] });

    await run();

    expect(sendPush).toHaveBeenCalledTimes(2);
    expect(store.state.every((d) => d.pushStatus === "sent")).toBe(true);
    // The claim incremented retryCount; success must not increment it again.
    expect(store.state.map((d) => d.retryCount)).toEqual([1, 1]);
  });

  test("two concurrent workers over the same document send it only once", async () => {
    // Both workers read the same pre-claim snapshot, then race the claim --
    // the scenario the job-level lease cannot cover on its own.
    const shared = [notif("a")];
    const store = buildStore(shared);
    const sendPush = jest.fn(async () => ({ success: true }));

    jest.resetModules();
    const scheduled = [];
    jest.doMock(CRON_PATH, () => ({
      schedule: (expr, handler) => {
        scheduled.push(handler);
        return { stop: () => {} };
      },
    }));
    jest.doMock(NOTIFICATION_PATH, () => store);
    jest.doMock(PUSH_SERVICE_PATH, () => ({ sendPush }));
    jest.doMock(LEASE_PATH, () => ({
      runWithLease: async (_n, _t, fn) => {
        await fn({ isHeld: () => true });
        return { ran: true };
      },
    }));
    require(RETRY_PUSH_PATH);

    await Promise.all([scheduled[0](), scheduled[0]()]);

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(store.state[0].retryCount).toBe(1);
  });

  test("a failed send consumes exactly one attempt and reschedules", async () => {
    const { sendPush, run, store } = loadJob({
      docs: [notif("a")],
      sendImpl: async () => ({ success: false }),
    });

    await run();

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(store.state[0].pushStatus).toBe("failed");
    expect(store.state[0].retryCount).toBe(1);
    expect(new Date(store.state[0].nextRetryAt).getTime()).toBeGreaterThan(Date.now());
  });

  test("skips an item another worker claimed between the read and the claim", async () => {
    const { sendPush, run, store } = loadJob({ docs: [notif("a")] });

    // The interleaving that matters: this worker has already READ the
    // document (retryCount 0) when the other worker's claim lands. Mutating
    // before the read would not exercise anything -- the filter would simply
    // be built from the newer value and still match.
    const realFind = store.find.getMockImplementation();
    store.find.mockImplementation(async (...args) => {
      const snapshot = await realFind(...args);
      store.state[0].retryCount = 1; // the other worker wins, right here
      return snapshot;
    });

    await run();

    expect(sendPush).not.toHaveBeenCalled();
    // Untouched by us: the increment belongs to the worker that won.
    expect(store.state[0].retryCount).toBe(1);
  });

  test("stops early when the lease is lost mid-run", async () => {
    jest.resetModules();
    const store = buildStore([notif("a"), notif("b")]);
    const sendPush = jest.fn(async () => ({ success: true }));
    const scheduled = {};

    jest.doMock(CRON_PATH, () => ({
      schedule: (expr, handler) => {
        scheduled.handler = handler;
        return { stop: () => {} };
      },
    }));
    jest.doMock(NOTIFICATION_PATH, () => store);
    jest.doMock(PUSH_SERVICE_PATH, () => ({ sendPush }));
    jest.doMock(LEASE_PATH, () => ({
      runWithLease: async (_n, _t, fn) => {
        await fn({ isHeld: () => false });
        return { ran: true };
      },
    }));
    require(RETRY_PUSH_PATH);

    await scheduled.handler();

    expect(sendPush).not.toHaveBeenCalled();
  });
});
