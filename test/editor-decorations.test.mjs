// editor.js 的两条装饰层约束，用源码断言锁住（没有真实 CodeMirror 运行时可跑）。
//
// 背景：2026-11-19 用户控制台刷屏，报的是
//   1. TypeError: tr is not a function            —— update(deco, tr) 的参数遮蔽了 i18n 的 tr 别名
//   2. Ranges must be added sorted by from ...    —— 先加了 line.to 的手柄，再加 line.from 的行装饰
// 两条都在上游 1.13.4 里同样存在（commit b3d748ca / 079997e0），与 TeleAgent 那批改动无关。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "editor.js"), "utf8");

test("dropField 的更新参数不再叫 tr，避免遮蔽 i18n 的翻译别名", () => {
  assert.equal(
    /update\(deco,\s*tr\)/.test(source),
    false,
    "参数名 tr 会遮蔽 `import { t as tr }`，拖拽高亮时会抛 tr is not a function",
  );
  const start = source.indexOf("const dropField");
  const end = source.indexOf("provide: (f) => EditorView.decorations.from(f)");
  assert.ok(start > -1 && end > start, "找不到 dropField 定义");
  const field = source.slice(start, end);
  assert.match(field, /update\(deco,\s*txn\)/, "参数应改名为 txn");
  assert.match(field, /txn\.changes/);
  assert.match(field, /txn\.state\.doc\.line/);
  // 文案仍然走翻译，不能顺手把这层去掉
  assert.match(field, /tr\(DROP_LABEL\[e\.value\.kind\]/);
});

test("buildDecorations 先加 line.from 的行装饰，再加所有 line.to 的 widget", () => {
  const start = source.indexOf("function buildDecorations");
  const end = source.indexOf("const SIMPLE_BULLET_RE");
  assert.ok(start > -1 && end > start, "找不到 buildDecorations");
  const build = source.slice(start, end);

  const lineDeco = build.indexOf("builder.add(line.from, line.from, Decoration.line");
  const gripWidget = build.indexOf("builder.add(line.to, line.to, Decoration.widget({ widget: new GripWidget");
  const progressWidget = build.indexOf("builder.add(line.to, line.to, Decoration.widget({ widget: new LineProgressWidget");
  const pillWidget = build.indexOf("builder.add(line.to, line.to, Decoration.widget({ widget, side: 1");
  for (const [name, index] of Object.entries({ lineDeco, gripWidget, progressWidget, pillWidget })) {
    assert.ok(index > -1, `找不到添加点：${name}`);
  }
  // RangeSetBuilder 只接受按 (from, side) 升序的添加，line.from 必须在 line.to 之前
  assert.ok(lineDeco < gripWidget, "行装饰必须排在拖拽手柄之前");
  assert.ok(lineDeco < progressWidget, "行装饰必须排在进度 widget 之前");
  assert.ok(lineDeco < pillWidget, "行装饰必须排在状态 pill 之前");
});
