"""
[UNIT] Regression test for the fake-ObjectId full-suite contamination fix.

Root cause: tests/support/fake_dependencies.py's FakeCollection._next_id()
used to build ids like "id000001" -- a valid identifier for
FakeObjectId (which accepts any string), but NOT a valid 24-character hex
string, so it would raise `bson.errors.InvalidId` the instant a REAL
`bson.ObjectId` (already installed in `sys.modules` by an earlier-running
real-dependency test in the same session) was used instead of the fake.
Fixed to always emit a deterministic, zero-padded 24-hex-digit string,
which both the real and fake ObjectId implementations accept.
"""

from tests.support import fake_dependencies


def test_fake_collection_next_id_is_a_valid_24_char_hex_id(mocked_lifecycle_env):
    fake_collection = fake_dependencies.FakeCollection()

    value = fake_collection._next_id()

    assert len(str(value)) == 24
    int(str(value), 16)  # must not raise -- proves it's valid hex


def test_fake_collection_next_id_is_deterministic_and_unique(mocked_lifecycle_env):
    fake_collection = fake_dependencies.FakeCollection()

    first = str(fake_collection._next_id())
    second = str(fake_collection._next_id())

    assert first != second
    assert len(first) == len(second) == 24
    int(first, 16)
    int(second, 16)

    # Deterministic: a fresh collection produces the exact same first id.
    fresh_collection = fake_dependencies.FakeCollection()
    assert str(fresh_collection._next_id()) == first
