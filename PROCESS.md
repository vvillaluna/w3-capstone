# PROCESS: Order/Payment Authorization Hardening

## Shape: single agent + adversarial reviewer subagent (not a fan-out)

One implementer (this session) did explore > SPEC > tests > implementation
sequentially each step depends on the last, nothing here decomposes into
independent slices worth a parallel hand-off. The `specs-reviewer` subagent
was the one deliberate multi-agent move: a separate, fresh-context reviewer
judging the diff without seeing the implementation reasoning (Day 3's
writer/reviewer pattern), specifically to avoid self-consistency bias on a
security-relevant change. A full orchestrated fan-out would have been
overkill for a 4-file, sequential change right call, per the brief's own
"knowing the difference is the skill" framing.

## What Claude got wrong, and how it was caught

1. The reviewer itself was inconsistent: Re-running `specs-reviewer`
   against the identical diff (069d45c..737a122) produced two different
   verdicts PASS, then FAIL, over the same underlying finding (SPEC.md's
   "Open question" section left unresolved after the decision was actually
   made). The second run also surfaced an additional point (`payment.js`'s
   inline role check vs. the permission-based pattern used elsewhere) that
   the first run didn't raise. Caught by: re-running the reviewer after
   deliberately tightening its Context check, then reading both verdicts'
   reasoning side by side rather than trusting either label on its own
   the tests staying green throughout, and no code changing between runs,
   is what confirmed this was reviewer variance, not a real regression
   introduced mid-review.
2. SPEC.md's open question was left dangling. The implementation
   correctly answered it (manager loses blanket payment access) via an
   explicit test-writing instruction, but the doc itself was never updated
   to say so a plan/reality drift that's invisible unless someone
   (or a reviewer) actually re-reads the spec after the fact. Fixed by
   appending a "Resolution" section rather than editing the original
   question in place, so the transcript still shows what was asked and
   when it was answered.

## Commits (the evidence trail)

- `069d45c`: failing tests, red for the right reason (assertion failures,
  confirmed via `npm test` output, not import/reference errors).
- `737a122`: implementation, green; `git diff 069d45c -- tests/` confirmed
  empty, so no test was weakened to reach green.
- `f9fdd44`: SPEC.md resolution, closing the reviewer's FAIL.