"""
[REAL-MONGODB] Repository integration tests against a real, isolated
MongoDB test database (see tests/integration/conftest.py for the isolation
guarantees).

NOT EXECUTED as part of Phase G's automated verification pass in the
sandboxed agent environment used for this project: that environment has no
outbound network access at all (confirmed via a direct TCP connection
attempt to the configured Mongo Atlas host, which failed with
"Temporary failure in name resolution"), so no real MongoDB instance --
Atlas or local -- is reachable from it, and pymongo itself is not
installed there either. `pytest.importorskip` and the `real_test_db`
fixture make this file skip cleanly (not silently mock, not error) in that
environment; running it in a normal developer machine or CI runner with
network access and pymongo installed will execute for real.

Run:
    ML_TEST_MONGO_CONN=mongodb://localhost:27017 \\
    ML_TEST_MONGO_DB_NAME=auth-db-ml-integration-test \\
    pytest tests/integration/test_mongo_repositories.py -v
"""

import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

pymongo = pytest.importorskip("pymongo")


@pytest.fixture
def repo_modules(real_test_db, monkeypatch):
    """Points db.mongo at the real test database, then imports the real
    repository modules against it."""
    import importlib
    import db.mongo as mongo_module
    monkeypatch.setattr(mongo_module, "get_db", lambda: real_test_db)

    import db.training_run_repository as runs
    import db.feedback_repository as feedback
    importlib.reload(runs)
    importlib.reload(feedback)
    monkeypatch.setattr(runs, "_runs", lambda: real_test_db["mltrainingruns"])
    monkeypatch.setattr(runs, "_locks", lambda: real_test_db["mltraininglocks"])
    return runs, feedback


@pytest.fixture(autouse=True)
def clean_repository_test_state(repo_modules):
    """
    Cross-test isolation fix (real Windows run). Two rounds of failures
    traced to the same root cause -- the dedicated test database's
    collections persist across tests within a run:

    Round 1 (lock only): the concurrent-caller, stale-reclaim, and
    wrong-owner lock tests each observed a PREVIOUS test's lock document.

    Round 2 (feedback): the reservation-race test's
    `ids_a | ids_b == inserted_feedback_ids` assertion failed with "extra
    items in the left set" -- `reserve_pending_feedback(run_id)` correctly
    (per its own docstring) reserves EVERY currently-"pending" document,
    so leftover pending feedback from earlier test runs was reserved
    alongside this test's own 6 freshly-inserted documents. This is not a
    production defect: it is expected, documented behavior of
    reserve_pending_feedback given a dirty database.

    Fix: clear mltraininglocks, mltrainingruns, and mlfeedbacks before AND
    after every test in this file (delete_many, not drop_database -- never
    touches indexes, per Phase G's standing "no drop_database" policy).

    Safe only because `real_test_db` (see tests/integration/conftest.py)
    already asserts `"test" in db_name.lower()` before this fixture -- or
    any test in this file -- ever runs; this never touches `auth-db` or
    any non-test database, and no production repository behavior
    (LOCK_ID, reserve_pending_feedback's "reserve everything pending"
    contract, etc.) is changed to make this pass.
    """
    runs, feedback = repo_modules
    runs._locks().delete_many({})
    runs._runs().delete_many({})
    feedback._collection().delete_many({})
    yield
    runs._locks().delete_many({})
    runs._runs().delete_many({})
    feedback._collection().delete_many({})


class TestTrainingLocks:
    def test_one_caller_claims_the_lock(self, repo_modules):
        runs, _ = repo_modules
        run_id = runs.create_run("manual")
        assert runs.try_claim_lock(run_id) is True

    def test_concurrent_caller_loses(self, repo_modules):
        runs, _ = repo_modules
        run_a = runs.create_run("manual")
        run_b = runs.create_run("manual")
        assert runs.try_claim_lock(run_a) is True, "precondition failed: run_a could not claim a clean lock"
        assert runs.try_claim_lock(run_b) is False
        runs.release_lock(run_a)

    def test_stale_owner_can_be_reclaimed(self, repo_modules):
        runs, _ = repo_modules
        run_a = runs.create_run("manual")
        run_b = runs.create_run("manual")
        assert runs.try_claim_lock(run_a) is True, "precondition failed: run_a could not claim a clean lock"
        # Force the lock's heartbeat far into the past to simulate staleness.
        real_test_db_handle = runs._locks()
        real_test_db_handle.update_one(
            {"_id": runs.LOCK_ID},
            {"$set": {"heartbeatAt": runs._utcnow() - __import__("datetime").timedelta(seconds=10000)}},
        )
        claimed, stale_run_id = runs.claim_or_reclaim(run_b, stale_after_seconds=1)
        assert claimed is True
        assert stale_run_id == run_a

    def test_wrong_owner_cannot_release_the_lock(self, repo_modules):
        runs, _ = repo_modules
        run_a = runs.create_run("manual")
        run_b = runs.create_run("manual")
        assert runs.try_claim_lock(run_a) is True, "precondition failed: run_a could not claim a clean lock"
        released = runs.release_lock(run_b)
        assert released is False
        lock = runs.get_active_lock()
        assert lock["runId"] == run_a

    def test_heartbeat_updates_only_the_owning_run(self, repo_modules):
        runs, _ = repo_modules
        run_a = runs.create_run("manual")
        assert runs.try_claim_lock(run_a) is True, "precondition failed: run_a could not claim a clean lock"
        before = runs.get_active_lock()["heartbeatAt"]
        time.sleep(0.01)
        runs.update_heartbeat(run_a)
        run_doc = runs.get_run(run_a)
        assert run_doc["heartbeatAt"] >= before


class TestTrainingRuns:
    def test_full_status_transition_sequence(self, repo_modules):
        runs, _ = repo_modules
        run_id = runs.create_run("manual")
        runs.mark_running(run_id)
        runs.mark_evaluating(run_id)
        runs.mark_activating(run_id, "legacy-fixed")
        runs.mark_activated(run_id, {"passed": True}, 1, "2024-01-01T00:00:00Z")
        doc = runs.get_run(run_id)
        assert doc["status"] == "activated"
        assert doc["completedAt"] is not None
        assert doc["activatedAt"] is not None

    def test_failed_failed_validation_failed_activation_transitions(self, repo_modules):
        runs, _ = repo_modules
        r1, r2, r3 = (runs.create_run("manual") for _ in range(3))
        runs.mark_failed(r1, "boom")
        runs.mark_failed_validation(r2, "gate failed")
        runs.mark_failed_activation(r3, "activation broke")
        assert runs.get_run(r1)["status"] == "failed"
        assert runs.get_run(r2)["status"] == "failed_validation"
        assert runs.get_run(r3)["status"] == "failed_activation"

    def test_run_listing_cursor_pagination(self, repo_modules):
        runs, _ = repo_modules
        ids = [runs.create_run("manual") for _ in range(5)]
        page1, cursor1 = runs.list_runs(limit=2)
        assert len(page1) == 2
        assert cursor1 is not None
        page2, _ = runs.list_runs(limit=2, before=cursor1)
        assert len(page2) == 2
        assert {r["runId"] for r in page1}.isdisjoint({r["runId"] for r in page2})

    def test_indexes_are_created_successfully(self, repo_modules):
        runs, _ = repo_modules
        runs.ensure_indexes()  # must not raise


class TestFeedback:
    def test_pending_reservation_and_no_double_reservation(self, repo_modules):
        """
        Real Windows run finding: both worker threads actually raised
        `TypeError: reserve_pending_feedback() got an unexpected keyword
        argument 'limit'` -- production's real signature is
        `reserve_pending_feedback(run_id)` only (confirmed by reading
        db/feedback_repository.py directly; batching via `limit` was never
        a real product requirement, so no production parameter was added).
        Because the threads were unmanaged `threading.Thread` objects,
        pytest only surfaced this as a `PytestUnhandledThreadExceptionWarning`
        and the test still reported "passed" -- a false positive.

        Fixed by: (1) removing the bogus `limit=10` kwarg, (2) running both
        calls through a `ThreadPoolExecutor` and calling `.result()` on each
        future, so any worker exception now fails the test immediately
        instead of being swallowed as a warning, and (3) asserting the
        actual atomic-reservation invariants against multiple inserted
        documents rather than requiring a particular split between the two
        callers (one caller legitimately reserving everything is correct
        behavior for this primitive, not a bug).
        """
        runs, feedback = repo_modules
        run_a = runs.create_run("manual")
        run_b = runs.create_run("manual")
        inserted_ids = [
            feedback._collection().insert_one({
                "status": "pending", "expenseName": f"x{i}", "expenseCategory": "Food",
            }).inserted_id
            for i in range(6)
        ]
        inserted_feedback_ids = set(inserted_ids)

        with ThreadPoolExecutor(max_workers=2) as executor:
            future_a = executor.submit(feedback.reserve_pending_feedback, run_a)
            future_b = executor.submit(feedback.reserve_pending_feedback, run_b)
            reserved_a = future_a.result()
            reserved_b = future_b.result()

        ids_a = {doc["_id"] for doc in reserved_a}
        ids_b = {doc["_id"] for doc in reserved_b}

        assert ids_a.isdisjoint(ids_b), "the same feedback document was reserved by both callers"
        assert ids_a | ids_b == inserted_feedback_ids, "reservation did not cover exactly the inserted documents"

        docs = list(feedback._collection().find({"_id": {"$in": inserted_ids}}))
        assert len(docs) == len(inserted_ids)
        reserved_count = 0
        for doc in docs:
            assert doc["status"] == "reserved", f"document {doc['_id']} was not reserved"
            assert doc["trainingRunId"] in (run_a, run_b), f"document {doc['_id']} has an unexpected owner"
            reserved_count += 1
        assert reserved_count == len(inserted_ids)

    def test_rollback_to_pending(self, repo_modules):
        runs, feedback = repo_modules
        run_id = runs.create_run("manual")
        fid = feedback._collection().insert_one({
            "status": "reserved", "trainingRunId": run_id,
            "expenseName": "x", "expenseCategory": "Food",
        }).inserted_id
        feedback.release_reserved_for_run(run_id, "test rollback")
        doc = feedback._collection().find_one({"_id": fid})
        assert doc["status"] == "pending"

    def test_activation_completion_to_trained(self, repo_modules):
        runs, feedback = repo_modules
        run_id = runs.create_run("manual")
        fid = feedback._collection().insert_one({
            "status": "reserved", "trainingRunId": run_id,
            "expenseName": "x", "expenseCategory": "Food",
        }).inserted_id
        finalized = feedback.finalize_trained_for_run(run_id)
        assert finalized == 1
        doc = feedback._collection().find_one({"_id": fid})
        assert doc["status"] == "trained"
