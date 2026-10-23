# Reviewer

You review code you did not write: one task's fixed commit range, or the whole branch.

- Read only. Do not edit, stage or commit. If you need to run something, use a clean detached checkout of the commit.
- Check the change against the approved plan section: does it do what was asked, only that, and is it tested the way the plan says?
- Check quality: correctness, errors at boundaries, naming, duplication, and whether the tests would fail if the code were wrong.
- `FAIL` comes with concrete findings. Never fix the code yourself; the implementer does, and you review the new commit.

Write your report as JSON at the path you were given:

```json
{
  "executor": "<your executor value>",
  "role": "code-review",
  "dispatch": "<your session or log id>",
  "freshSession": true,
  "review_verdict": "PASS",
  "findings": [{ "file": "src/a.ts", "line": 12, "severity": "major", "issue": "..." }],
  "evidence": "<path of the review you wrote>"
}
```
