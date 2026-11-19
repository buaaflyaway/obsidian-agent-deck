# Obsidian 1.15.1 实机验收记录（TeleAgent Linux 派发菜单）

时间：2026-11-19 22:47–23:10 CST
环境：Deepin 25 / treeland Wayland + XWayland（`DISPLAY=:1`），Obsidian 1.15.1（Electron 43.8.9）用 `dpkg-deb -x` 解到 `temp/obsidian-app/opt/Obsidian/obsidian`，无 root、未写 `/usr`；专用测试 vault `temp/vault-e2e`；插件 `agent-deck` 1.13.4（本地构建后 `npm run install:plugin`）。
启动：`HOME=temp/obsidian-home XDG_CONFIG_HOME=... DISPLAY=:1 obsidian --no-sandbox --ozone-platform=x11 --remote-debugging-port=9223 --disable-gpu`
备注：新 vault 默认 restricted mode，需 `app.plugins.setEnable(true)`（或 UI 里打开社区插件）后插件才会加载；这是一次性测试环境操作。

## a) 右键任务行菜单项

- 测试行：`- DOING 验证 Linux 派发 50%`（`DOING` + 手动进度 50% 才会渲染 `.ad-prog` 进度控件；普通 TODO 行没有 `.ad-prog`/`.ad-pill`，右键不会出现插件菜单）。
- 窗口 DPR = 1.25；CDP viewport 坐标 × 1.25 才是 xdotool 屏幕坐标。
- 物理右键命令：`xdotool mousemove 977 368; xdotool click 3`（窗口 48234500，位置 290,40；`.ad-prog` viewport 中心约 550,262）。
- 菜单 DOM 文本（`.menu`）：

```text
查看正文与保存对话 · TeleAgent · 会话 1
在客户端打开 · TeleAgent · 会话 1
取消交接 · TeleAgent · 会话 1
重新委派（新会话）· DeepSeek Harness
重新委派（新会话）· TeleAgent
派发到 TeleAgent（自动填写，需手动点运行）
在项目工作台拆解并分配小队
绑定或合并到其他任务
```

- 截图：`temp/probe/shots/obsidian-menu-linux.png`（菜单可见，Linux 文案）。
- 结论：**PASS**（Linux 文案、右键物理菜单）。

## b) 点击菜单项后

点击 `派发到 TeleAgent（自动填写，需手动点运行）` 后，Obsidian 通知：

```text
📋 任务已复制，粘贴到 TeleAgent 里发出
派发失败（focus）：无法把焦点切到 TeleAgent 主窗口（当前焦点：Command failed: /usr/bin/xdotool getwindowfocus
XGetInputFocus returned the focu）；请先手动切到该窗口，t...
```

- TeleAgent 输入框**没有**收到文本（截图 `temp/probe/shots/obs-after-dispatch.png`，仍为空）。
- 原因（本机实测）：Obsidian 为前台时，treeland 不会把焦点交给 TeleAgent；`windowfocus` 设置的 X 焦点在两次独立的 xdotool 进程之间被重置为 PointerRoot，`getwindowfocus` 直接报错。`xdg-open teleai-cowork://` 与二次运行 `/usr/bin/teleagent` 都没能把 TeleAgent 抬到前台（后者还遇到 SingletonLock 只读）。
- 对照：用 treeland 原生协议把 TeleAgent 激活到前台后，**单进程**执行
  `xdotool windowfocus 18874386 getwindowfocus mousemove --window 18874386 700 780 click 1 key --clearmodifiers ctrl+v`
  能成功粘贴测试文本 `AD-CHAIN-TEST`（截图 `temp/probe/shots/chain-test.png`，随后已清空，见 `chain-cleared.png`）。
- 结论：**FAIL（焦点）**。这是已复现的产品缺口，不是偶发：需要（1）合成器级窗口激活（treeland 原生 helper，或用户先手动切到 TeleAgent），并且（2）把 focus/click/paste 合并成一次 xdotool 调用（或去掉跨进程焦点校验的竞态）。

## d) 缺 xdotool 的降级

在 Obsidian renderer 里把 `process.env.PATH` 清空后调用同一 dispatch：

```text
📋 任务已复制，粘贴到 TeleAgent 里发出
派发失败（dependency）：缺少 Linux 派发依赖：xdotool
```

- 没有异常/崩溃；TeleAgent 未收到文本。
- 结论：**PASS**（结构化降级）。

## c) 未点「运行」

- 测试全程没有点 TeleAgent 的「运行」/发送按钮；SQLite `session` 计数保持 **117**（与测试前一致），没有新建会话。

## 产物

- 截图：`temp/probe/shots/obsidian-menu-linux.png`、`obs-before-dispatch.png`、`obs-after-dispatch.png`、`chain-test.png`、`chain-cleared.png`。
- 测试 vault 保留：`temp/vault-e2e`（未动真实 Vault）。
- Obsidian 进程已关闭；桌面焦点已还给用户 Edge。

## 修复后复测（2026-11-19 23:50–00:10 CST）

修复：`src/native/treeland-activate.c`（treeland 原生 `foreign_toplevel_manager_v1` 激活，源码入库、产物 `bin/` 不入库）+ `buildFocusPasteArgs` 把 focus/点击/`Ctrl+V` 合并成一次 xdotool 调用。

```
# 前置：Obsidian 前台焦点 48234500；经 CDP 调用 plugin.dispatchToTeleagent("task-e2e.md", 2, lines)
{"ms": 1855, "notices": ["已填入任务文本，请在 TeleAgent 里手动点「运行」· task-e2e"]}
# 焦点：18874386（TeleAgent 主窗），即激活成功
# 输入框内容 Ctrl+A/C 读回剪贴板：
- DOING 验证 Linux 派发 50%

（来自 Obsidian：task-e2e.md）
# 清空后用哨兵剪贴板复读：仍为哨兵 ⇒ 输入框已空

# 降级复测：chmod -x 插件目录里的 helper 后重跑
{"ms": 273, "notices": ["派发失败（focus）：缺少 treeland 窗口激活 helper：treeland-activate；…请先手动切到 TeleAgent 再派发（当前焦点：未知（没有 X 焦点））"]}
# 没有任何 mousemove / ctrl+v 调用
```

结论：b 在“Obsidian 前台 → 右键派发”的真实路径上通过；helper 缺失时明确拒绝，不盲点盲打。
