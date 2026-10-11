# Verdicts, severity and the report

## Finding record (in `findings.md`)

Every candidate gets one block:

```
### F-<nn> <short title>
- Verdict: confirmed | needs_validation | rejected
- Area / check: C2
- Attacker: <principal from SURFACE.md> holding <exact access>
- Victim: <whose data / which money / which action>
- Trace: route → middleware → controller → service → repository (file:line each)
- What happens: <concrete result>
- Why nothing stops it: <the checks you looked for and didn't find>   (confirmed)
- Open fact: <the one thing source can't settle>                       (needs_validation)
- Plan to settle it: <local test or owner-observed check>              (needs_validation)
- Blocked by: <the code/constraint that stops it>                      (rejected)
- Severity: <from rubric>                                               (confirmed only)
- Smallest fix: <one or two sentences, naming the file>                (confirmed only)
- Regression of: <H6 / PR #121 / R6 (a)…>                               (if applicable)
```

## Severity rubric (LSP-specific)

- **Critical** — anonymous attacker reads other guests' personal data in bulk, takes
  over any account, moves money, or runs code on the server.
- **High** — anonymous attacker reads one guest's data or creates bookings/money
  records they shouldn't; or a logged-in user crosses into another property,
  escalates their role, or moves money without the lock/audit.
- **Medium** — logged-in user reads data their role shouldn't (same property);
  a session survives logout/deactivation; stored XSS reachable by staff;
  rate limit bypass on login or lookup.
- **Low** — information leak with little use (internal ids, versions), missing
  hardening with a plausible but unlikely path.
- **Info / 👤 Your call** — an owner decision with a security cost, or a
  best-practice gap with no current path. Not counted as a defect.

## `REPORT.md` — for the owner and the developer

Plain English first; the owner should understand the top section without
technical knowledge. Use typographic apostrophes and em-dashes, as the rest of
the project's client documents do.

1. **Summary** — date, commit, size (quick/standard), areas checked, one
   paragraph: "how safe is it" in plain words. Counts by severity.
2. **What needs fixing** — confirmed findings, most severe first. For each: a
   one-sentence plain-English explanation of who could do what, then 🔧 the
   technical trace and fix.
3. **Needs checking** — needs_validation items with the exact open fact and plan.
4. **👤 Your call** — owner decisions with a security trade-off.
5. **What was checked and found sound** — the covered ledger rows, grouped by
   area, one line each naming what makes it safe. This is the evidence of
   coverage; don't skip it.
6. **Not checked** — deferred / out-of-scope areas, so nobody assumes they were.

Never include secret values, real guest data, or instructions for attacking the
live site.
