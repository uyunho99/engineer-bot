import { describe, expect, test } from "bun:test";
import { exportFileName, stripMaterializedHeader } from "./materialize";

/**
 * `--export` — 방향이 뒤집힌 경우 (AMENDMENTS A14).
 *
 * brainstorming 이 계약 경로에 직접 쓰므로, `/plan-eng-review` 가 자기 입력을
 * 찾게 하려면 gstack 명명으로 내보내야 한다.
 */
describe("exportFileName — eng-review 의 glob 과 맞아야 한다", () => {
  const at = new Date(2026, 8, 3, 15, 10, 51); // 로컬 시각 2026-09-03 15:10:51

  test("실측한 gstack 파일명과 같은 형태다", () => {
    expect(exportFileName("yunho", "feature-plan-preflight", at)).toBe(
      "yunho-feature-plan-preflight-design-20260903151051.md",
    );
  });

  test("eng-review 의 glob `*-<branch>-design-*.md` 에 걸린다", () => {
    const name = exportFileName("u", "feature-x", at);
    expect(name).toMatch(/^.*-feature-x-design-.*\.md$/);
  });

  test("한 자리 월·일·시가 0으로 채워진다 — ls -t 순서와 이름 순서가 어긋나지 않게", () => {
    const n = exportFileName("u", "s", new Date(2026, 0, 5, 3, 4, 5));
    expect(n).toContain("-design-20260105030405.md");
  });
});

describe("stripMaterializedHeader — 왕복해도 헤더가 쌓이지 않는다", () => {
  const header =
    "<!-- materialized from a-b-design-1.md by controller/materialize.ts\n" +
    "     gstack 원본을 수정하지 마세요 -->\n\n";

  test("헤더를 벗긴다", () => {
    expect(stripMaterializedHeader(header + "# 설계\n")).toBe("# 설계\n");
  });

  test("헤더가 없으면 그대로 둔다", () => {
    expect(stripMaterializedHeader("# 설계\n")).toBe("# 설계\n");
  });

  test("본문 중간의 비슷한 주석은 건드리지 않는다 — 앞의 것만 벗긴다", () => {
    const body = "# 설계\n\n<!-- materialized from x -->\n";
    expect(stripMaterializedHeader(body)).toBe(body);
  });

  test("두 번 벗겨도 같다 (멱등)", () => {
    const once = stripMaterializedHeader(header + "본문");
    expect(stripMaterializedHeader(once)).toBe(once);
  });
});
