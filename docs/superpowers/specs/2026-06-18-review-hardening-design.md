# Design: review hardening — kill truncated-diff false-negatives + vacuous-test false-positives

**Date:** 2026-06-18
**Status:** Approved (design phase)
**Feature:** make gproj's `review` step judge correctly on large phases.

## Problem

Across many phases the planner `review` was wrong in two opposite ways:
1. **False-negative on big phases.** The DIFF fed to the reviewer is truncated at
   `MAX_DIFF_CHARS = 8000`. On a 600+ line phase the reviewer saw ~1/3, then
   concluded "feature missing / acceptance not met" — even though the verifier ran
   the FULL test suite green (proving the code exists) and the RUN EVIDENCE already
   lists every changed file + diffstat.
2. **False-positive from vacuous tests.** Once, verifier + review were both green
   while two behavioral fixes were unimplemented, because the added tests only
   asserted sanitize / that a valid input survives — never that the bad input was
   dropped. Passing tests != met acceptance.

The pack already includes the full `changed files` list + `diffstat` in RUN
EVIDENCE; the reviewer just isn't told how to use them, and the DIFF is over-tight.

## Decisions (locked)

| Item | Decision |
|---|---|
| Diff budget | Raise `MAX_DIFF_CHARS` 8000 -> 24000 (more code visible; still bounded; assembler trims if the pack overflows). |
| Existence vs truncation | Strengthen the review instruction: the DIFF may be truncated (diffstat shows true breadth); the verifier ran the FULL suite, so passing tsc+tests is AUTHORITATIVE for code existence. Do NOT conclude a feature/acceptance item is missing solely because it is absent from the (possibly truncated) DIFF — only flag missing if the changed-files list lacks the expected file. |
| Test adequacy | Add a review dimension: verify the tests ASSERT the acceptance behavior (e.g. that bad input is DROPPED / the new branch is exercised), not merely that they pass or that a happy path survives. Flag acceptance items with no corresponding assertion as "unverified by tests". |

## Components

| Unit | File | Change |
|---|---|---|
| Diff cap | `src/verifier/git.ts` | `MAX_DIFF_CHARS = 24000` |
| Review instruction | `src/commands/review.ts` | extend the `instruction` string: truncation/existence guidance + the test-adequacy dimension (add as explicit questions the reviewer must answer) |

No schema/CLI surface change. The pack already carries changedFiles + diffstat.

## Review instruction additions (append to the existing questions)

- "(6) Are the TESTS adequate — do they ASSERT the acceptance behavior (bad input
  dropped, new branch exercised, error path hit), not just pass or cover a happy
  path? List any acceptance item with no asserting test."
- A guidance paragraph: "The DIFF below may be truncated (see the diffstat for the
  full file breadth and line counts). The verifier ran your FULL test + typecheck
  suite; a green verifier is authoritative that the code EXISTS and compiles. Do
  NOT report a feature as missing merely because it is not visible in the truncated
  DIFF — judge 'missing' only when the changed-files list lacks the expected file.
  Judge correctness and test-adequacy from what IS visible plus the verifier."

## Testing (>=80%)

- `git.ts`: `MAX_DIFF_CHARS` is 24000 (a >8000-char diff is no longer truncated at 8000).
- `review.ts`: the built instruction string contains the test-adequacy question and
  the truncation/existence guidance (assert on substrings via the existing review
  test harness / a planner spy capturing the instruction).

## Scope

- **In:** diff budget raise, review-instruction hardening (existence + test-adequacy).
- **Out:** automated test-assertion analysis (static "does this test assert X");
  chunked multi-part diff review; coverage gating. (Instruction-level for now.)
