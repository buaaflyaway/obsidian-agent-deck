# TeleAgent Linux 派发通道实测（AT-SPI / xdotool / 本地端口·深链）

> 状态：**探测报告（三轮，入库证据）**。第一轮 **2026-11-19 21:28–21:45 CST**（TeleAgent GUI 未运行，只做无窗口探测）；第二轮 **21:46–22:05 CST**（负责人手动启动 GUI 后的窗口级实测）；第三轮 **22:10–22:30 CST**（用户级 `xclip` 剪贴板粘贴实测 + 生产可行性评估）；**22:29 在负责人批准下完成一次真实端到端提交**（见 §2.9）。仓库 `src/` 未改；证据已随 Linux 派发后端一并入库（脱敏：账号 ownerDir / 用户名 / 绝对家目录）。
> 环境：Deepin 25（内核 `6.18.48-amd64-desktop-rolling`），**treeland Wayland** 会话（`XDG_SESSION_TYPE=wayland`、`WAYLAND_DISPLAY=treeland.socket`），XWayland `DISPLAY=:1`，屏幕 1920×1080。
> 客户端：TeleAgent 桌面版 **3.1.1-rc.1**（Electron **43.1.0** / Chromium **150.0.7871.47**）；内置 super-agent-code 运行时 **3.1.1-dev-3-1-1-20261118111515**；运行中的 Go 后端在 `127.0.0.1:4397` 报告 **dev-3.1.1-785b86**。
> 合规口径：全部探测为本机只读或 localhost 回环；**未安装系统包、未读凭据文件、未发外网请求**（数据库用 `file:...?mode=ro` 只读打开）。第二轮只做了**可逆**的窗口激活与输入测试：未点「运行」、未回车提交，输入用 `Escape + Ctrl+A + Delete/Backspace` 清空并截图确认。

---

## 0. 一页结论

| 通道 | 本机结论 | 关键证据 | 剩余缺口 |
| --- | --- | --- | --- |
| **1. AT-SPI** | **当前不可用（缺系统包）**。装包后能否拿到 TeleAgent 元素树、能否定位 Slate 输入框与「运行」**需实机确认** | 无 `org.a11y.Bus`/`at-spi-bus-launcher`/`registryd`；GTK 明确报“无法获取无障碍总线”；`toolkit-accessibility=false`；Electron 二进制已链接 `libatspi.so.0`/`libatk-bridge` | 需装 `at-spi2-core`（候选 2.59.1-2deepin1）；装后需 GUI 重启/带 `--force-renderer-accessibility` 实测 |
| **2. xdotool** | **窗口级链路已打通**：窗口命中、合成器级激活、焦点设置、鼠标点击、Tab/数字键都实测有效；**剪贴板粘贴中文已实测成功**（用户级 `xclip` + `Ctrl+V`）；直接逐字符打字仍不可用（字母被 IME 组合） | 主窗 `0x1200012`（class `teleagent`，1513×1005+176+40）；`tl-act` 激活后 `getwindowfocus=18874386`；点「换一换」卡片刷新；`123` 可打；`zz` 无字；**粘贴 `AD派发粘贴测试-2026` 成功、清空后截图确认**（`paste-after.png` / `paste-cleared.png`） | 「运行」按钮坐标/状态未测；生产环境 `xclip` 不是系统自带（见 §5.8） |
| **3. 本地端口** | **存在但不可无凭据使用**：`127.0.0.1:4397`（Go 后端，`/ready` 200、业务 401）、`127.0.0.1:19876`（404）；**无 8459/8388、无 DevToolsActivePort** | `ss -ltn`、`curl` 原始响应、`find` 结果 | 私有协议 + 本地鉴权 → 按合规口径排除，不逆向 |
| **3. 深链** | scheme **已注册**（`teleai-cowork` → `teleagent.desktop`，`Exec=... %U`）；单实例转发有日志证据；**能否唤起并带参未实测** | `gio mime`、desktop 文件、日志 `Second instance detected, focusing existing window` | 未触发唤起（避免把客户端切到登录/其它页面） |

**推荐**：主通道 **AT-SPI**（语义定位 + 可读控件状态，最接近 Windows UIA，需装包验证）→ 降级 **xdotool**（窗口操作已实测，但文本必须走**剪贴板粘贴**而非直接打字）→ 兜底 **唤起 + 剪贴板 + 人工确认**。无论哪条，成功判据统一用 **SQLite 只读回读**（本机已实测可读）。

---

## 1. 环境与前置事实

### 1.1 GUI 运行中（第二轮由负责人手动启动）

```text
$ DISPLAY=:1 xdotool search --class teleagent
18874386
20971521
18874372
20971523

$ xprop -id 18874386 WM_CLASS WM_NAME _NET_WM_PID WM_WINDOW_ROLE
WM_CLASS(STRING) = "teleagent", "teleagent"
WM_NAME(UTF8_STRING) = "TeleAgent 星辰超级智能体"
_NET_WM_PID(CARDINAL) = 50510
WM_WINDOW_ROLE(STRING) = "browser-window"

$ xdotool getwindowgeometry --shell 18874386
WINDOW=18874386  X=176  Y=40  WIDTH=1513  HEIGHT=1005  SCREEN=0
```

同时存在的辅助窗口（同一进程 50510）：

| id | 标题 | class | 几何 |
| --- | --- | --- | --- |
| `0x1200012` (18874386) | `TeleAgent 星辰超级智能体` | `teleagent`/`teleagent` | 1513×1005+176+40（主窗） |
| `0x1200004` (18874372) | `TeleAgent Screenshot` | `teleagent`/`teleagent` | 1013×755+426+165 |
| `0x1400001` (20971521) | `teleagent` | `teleagent`/`Teleagent` | 10×10+10+10 |
| `0x1400003` (20971523) | `teleagent` | `teleagent`/`Teleagent` | 200×200+0+0（启动后新增） |

> 注意：辅助窗的 id/数量会随启动阶段变化（早期 3 个，随后出现 200×200 窗口变成 4 个）；实现里必须**按标题/几何/角色挑主窗**，不能取“第一个”。

> PID 50510 是宿主 PID（`_NET_WM_PID`），本 agent 的 PID 命名空间隔离，`ps -p 50510` 看不到它——**这不代表应用没运行**；X 窗口与网络端口是共享的。

### 1.2 客户端自己证明：Linux GUI 走 XWayland（x11）

来自客户端启动日志（只读）：

```text
[2026-11-19T09:00:13.304Z] [INFO] [Main]  Linux desktop env {
  session: 'wayland',
  desktop: 'DDE',
  display: ':1',
  waylandDisplay: 'treeland.socket',
  gtkImModule: 'fcitx',
  xmodifiers: '@im=fcitx',
  forceX11ForWayland: false,
  launcherUsed: true,
  launcherReason: 'wayland-x11-compat',
  keepWayland: false,
  requestedOzonePlatform: 'x11',
  commandLineOzonePlatform: 'x11'
}
```

启动器（`/usr/bin/teleagent` → `/opt/TeleAgent/teleagent-launcher`）在 Wayland 会话下自动加 `--ozone-platform=x11`。因此第二轮的窗口能被 `xdotool` 看到；若用户以 `TELEAGENT_KEEP_WAYLAND=1` 启动，则不在 X 树里（未实测该模式下的窗口行为）。

### 1.3 版本对应关系（写清楚，不混用）

| 名称 | 版本 | 来源 |
| --- | --- | --- |
| 客户端应用（标题栏/asar `package.json`） | **3.1.1-rc.1** | 窗口标题、`resources/app.asar` 内 `package.json`、日志 `version: '3.1.1-rc.1'` |
| Electron / Chromium | **43.1.0 / 150.0.7871.47** | 客户端启动日志 |
| 内置 super-agent-code 运行时 | **3.1.1-dev-3-1-1-20261118111515** | `~/.local/share/TeleAgent/runtimes/.version.json`、`runtimes/super-agent-code/package.json` |
| 运行中的 Go 后端 | **dev-3.1.1-785b86** | `HTTP 4397` 响应头 `Super-Agent-Code-Version`；字符串 `785b86` 亦出现在 `runtimes/super-agent-code/bin/TeleAgent` 内 |

> 关系说明：客户端 3.1.1-rc.1 内置了开发构建的 super-agent-code（`3.1.1-dev-...`），其 Go 二进制自报 `dev-3.1.1-785b86`。**客户端版本 ≠ 后端版本**，写入文档/日志时不要只写一个“3.1.1”。

### 1.4 本轮新增的只读取证手段

- **X 窗口截取**：`DISPLAY=:1 import -window 0x1200012 out.png` 可取到**窗口本身**（即使被别的窗口遮挡也能取到内容）。
- **合成器级截屏**：用 `zwlr_screencopy_manager_v1` 自建 `wpe-shot`（源码复用本机既有工具，见 §8），用于判断“**谁在最前面**”。第一次截屏发现：主窗被**全屏的 Microsoft Edge** 盖住，`import` 看到的是被遮挡的 TeleAgent 内容——这是第一轮“打字没反应”的直接原因。

---

## 2. 通道 2：xdotool（窗口级实测，第二轮）

### 2.1 窗口命中与属性

```text
$ xdotool search --name 'TeleAgent 星辰超级智能体'
18874386
$ xdotool search --class teleagent
18874386
20971521
18874372
```

与 `xwininfo -root -tree` 一致；`_NET_CLIENT_LIST` 在应用启动后变为 `0x1200012, 0x3800007`。窗口是 XWayland 客户端（`DISPLAY=:1` + root 由 `wlroots wm` 管理），不是 Wayland 原生窗口。

### 2.2 激活/焦点：`windowactivate` 无效，必须走合成器级激活

实测（只读/可逆）：

```text
# 激活前
$ xprop -root _NET_ACTIVE_WINDOW
_NET_ACTIVE_WINDOW(WINDOW): window id # 0x200005      # 不是 TeleAgent，是 wm 占位窗

$ xdotool windowactivate --sync 18874386 ; echo rc=$?
rc=0
$ xprop -root _NET_ACTIVE_WINDOW
_NET_ACTIVE_WINDOW(WINDOW): window id # 0x200005      # 没变
$ xdotool getwindowfocus
XGetInputFocus returned the focused window of 1 ...     # PointerRoot，焦点没有到主窗
```

对照实验：先激活一个临时 `xev` 窗口，`_NET_ACTIVE_WINDOW` 会变成 xev 的 id；再 `windowactivate` 回到 TeleAgent，属性仍是 xev 的 id —— **对 TeleAgent 主窗的 `_NET_ACTIVE_WINDOW` 请求没有生效**（对普通 xev 窗口则生效）。因此不能把 `windowactivate` 当作可靠原语；它也不是“返回值 0 就等于焦点到位”。

**可用做法**：用 DDE 原生的 `treeland_foreign_toplevel_manager_v1`（Wayland 协议）对窗口 `activate`。本轮编了一个小工具 `tl-act`（源码基于既有 `wpe-tl.c`，见 §8）实测：

```text
$ tl-act
treeland 原生协议：发现 3 个窗口
    deepin-terminal    min=no  act=no   hly@hly-PC: ~ - 终端
    microsoft-edge     min=no  act=yes  Git pull 更新代码 — DeepSeek Harness ... - Microsoft Edge
    teleagent          min=no  act=no   TeleAgent 星辰超级智能体

$ tl-act -a "TeleAgent 星辰"
目标: TeleAgent 星辰超级智能体 (teleagent)
  [activate 后]
    microsoft-edge     min=no  act=no
    teleagent          min=no  act=yes   TeleAgent 星辰超级智能体

# 激活后立刻验证 X 焦点：
$ xdotool getwindowfocus
18874386
$ xdotool getactivewindow
18874386
```

→ **合成器级激活成功**：TeleAgent 抬到前台，X 输入焦点真正落到主窗（`getwindowfocus` 返回 18874386）。这是 Linux 上“一键派发”必须先解决的一步；**单靠 xdotool 的 `windowactivate`/`_NET_ACTIVE_WINDOW` 在 treeland 上不可行**。

> 注：`xdotool windowfocus`（XSetInputFocus）在合成器焦点本来就在主窗时可以把焦点设进去，但一旦焦点在别的窗口，它会被合成器/XWayland 重置回 PointerRoot；因此不能只靠 `windowfocus`。

### 2.3 鼠标：已实测对应用生效

激活后，窗口内相对坐标 = 屏幕坐标 − (176,40)。实测：

- 点击输入框（窗口内约 `700,780`）→ 输入框出现蓝色焦点环与光标；
- 点击「换一换」（窗口内约 `1345,620`）→ 四张建议卡片**内容刷新**（从「调研AI办公应用…」变为「查招标商机…」），证明 XTEST 鼠标点击被应用接收；
- `xdotool mousemove --window 18874386 700 780` 后 `getmouselocation` 返回 `window:18874386`，坐标换算正确。

### 2.4 键盘：部分有效，**字母被输入法吞掉**

在激活 + 点击输入框后实测：

| 输入 | 结果 | 证据 |
| --- | --- | --- |
| `xdotool key Tab` | 焦点从输入框移到「+」按钮，出现「添加」tooltip | 截图 `after-tab.png` |
| `xdotool type '123'` | **输入框出现 `123`** | 截图 `test-123.png` |
| `xdotool type 'zz'`（两次） | **输入框无字** | 截图 `test-zz.png`、`ime-off2-zz.png` |
| `xdotool key a` + `key space` + `type --window 'bc'` | 输入框出现中文「**奥氮平肉蹦奥**」（拼音组合被空格提交） | 截图 `type-window.png` |
| `xdotool type 'ad-probe-测试'`（**合成器激活之前**，Edge 全屏在前） | 未落到 TeleAgent（焦点不在它，截图对比无文本） | 截图 `typing-before.png` / `typing-after.png` |

→ **键盘事件确实到达应用**（Tab、数字键、Ctrl+A 选择都能工作），但**字母键被输入法/GTK IM 组合掉**，不会直接变成字符；合成器已聚焦、X 焦点正确、DOM 焦点在输入框，仍然如此。`fcitx5-remote` 查询状态为 `1`（但行为与 IME 组合一致，见 §7 未验证项——不排除 Electron 的 GTK IM 模块而非 fcitx daemon 本身）。

**结论**：xdotool 直接“逐字符打字”在 Linux 上**不可靠**；派发文本必须走**剪贴板粘贴**（`Ctrl+V` 不经过 IME 组合），或 AT-SPI 的文本写入，或临时切换输入法状态（未验证、且会改用户输入状态）。

### 2.5 清理与安全边界

- 测试前输入框为空（仅 placeholder，已截图确认）；测试中出现的「奥氮平肉蹦奥」与「123」均用 `Escape + Ctrl+A + Delete/Backspace` 清空，最终截图 `clear3.png` 确认输入框为空、发送按钮恢复灰色。
- **未按 Enter、未点「运行」/发送按钮**；未创建任务（数据库无新增会话，见 §2.6）。
- 测试期间把 TeleAgent 激活到前台会遮挡用户正在用的 Edge；测试后已用同一协议把 `microsoft-edge` 重新激活（`tl-act -a "DeepSeek Harness"`），`act=yes` 已恢复。
- 合成器激活之前的按键没有落到 TeleAgent；同一时刻的合成器截屏（`screen.png`）显示 Edge 全屏在前、其 DSH 输入框为空，未观察到字符进入。
- 合成器激活之后的字母输入**没有**进入 TeleAgent 输入框，而是被输入法组合（见上表）；数字/功能键正常。

### 2.6 数据面交叉验证（只读）

```text
$ sqlite3 "file:~/.local/share/TeleAgent/users/<ownerDir>/teleagent.db?mode=ro" \
  "select count(*) from session;"
116        # 与测试前一致，未新建任务
```

### 2.7 通道 2 结论

| 能力 | 结论 |
| --- | --- |
| 找到主窗 | ✅ 实测（`xdotool search --class teleagent`） |
| 抬到前台 | ✅ 需 **treeland 原生协议**；`windowactivate` 无效 |
| 设键盘焦点 | ✅ 激活后 `getwindowfocus` = 主窗 id |
| 鼠标点击（输入框/按钮） | ✅ 实测生效 |
| 输入 ASCII 数字/功能键 | ✅ 实测 |
| 输入字母/字面文本 | ❌ 被 IME 组合（需剪贴板/AT-SPI） |
| 点「运行」 | ✅ **已获批准实测一次**（2026-11-19 22:29）：坐标比例 + 蓝色像素/焦点双重校验后点击，真实建会话 `ses_e0bc97898ffe3NfF3EYllOYSgv`（见 §2.9） |
| 读「运行」enabled 状态 | ⚠️ xdotool 读不到控件状态；端到端实测用「发送按钮变蓝」的像素判据代替（614 个蓝色像素） |

### 2.8 剪贴板粘贴实测（第三轮，用户级 `xclip`，无 root）

工具（Lead 提供的用户级副本，**非系统安装**）：

```text
$ file temp/root/usr/bin/xclip      # ELF x86-64, dynamically linked
$ ldd temp/root/usr/bin/xclip | grep 'not found'   # 无输出，依赖齐全
$ DISPLAY=:1 temp/root/usr/bin/xclip -version
xclip version 0.13
```

写入 → 读回：

```text
$ printf 'AD派发粘贴测试-2026' | DISPLAY=:1 temp/root/usr/bin/xclip -selection clipboard
$ DISPLAY=:1 temp/root/usr/bin/xclip -selection clipboard -o
AD派发粘贴测试-2026
```

粘贴链路（只读前置：输入框为空，截图 `paste-before.png`）：

```text
$ tl-act -a "TeleAgent 星辰"          # 合成器级激活（min=yes → act=yes）
$ DISPLAY=:1 xdotool getwindowfocus
18874386
$ DISPLAY=:1 xdotool mousemove --window 18874386 700 780 click 1
$ DISPLAY=:1 xdotool key --clearmodifiers ctrl+v
```

结果：输入框出现 **`AD派发粘贴测试-2026`**（中文+ASCII 原文），发送按钮由灰变蓝（`paste-after.png`）。

清理与确认：

```text
$ xdotool key --clearmodifiers Escape
$ xdotool key --clearmodifiers ctrl+a
$ xdotool key --clearmodifiers Delete
$ xdotool key --clearmodifiers BackSpace
```

截图 `paste-cleared.png` 确认输入框为空、发送按钮恢复灰色；`session` 计数仍为 **116**（未新建会话）；**未回车、未点「运行」**。

→ **结论：剪贴板 + `Ctrl+V` 是 Linux 上可用的文本注入路径（含中文）；直接 `xdotool type` 只对数字/功能键有效。**

### 2.9 端到端实测（2026-11-19 22:29，负责人批准的一次真实提交）

> 目标：验证「点运行 → 会话真的建了 → SQLite 回读认领」。**只做一次**，第一次即成功，没有重试。

**前置校验（全部只读）**：

```text
$ tl-act -a "TeleAgent 星辰"          # act=yes
$ xdotool getwindowfocus
18874386                              # 焦点在主窗
$ 窗口几何
WIDTH=1513 HEIGHT=1005                # 宽高比 1.505，通过几何 sanity
$ 输入框内容（截图）
Agent Deck 端到端测试：回复收到
$ 发送按钮蓝色像素（窗口内 60×60，中心 1358,897）
blue pixels = 614                     # 灰态为 0，变蓝说明输入已被接受
```

**提交坐标（窗口相对比例，非绝对像素）**：

- 发送图标蓝色像素质心：`(1358, 897)`；
- 比例：`x = 1358/1513 = 0.8976`，`y = 897/1005 = 0.8925`；
- 点击：`xdotool mousemove --window 18874386 1358 897 click 1`；
- 校验条件：`getwindowfocus == 18874386` + 蓝色像素 ≥ 50（实际 614）+ 输入框截图非空；任一不满足即不点。

**提交后 SQLite 只读回读（`sqlite3 -readonly`）**：

```text
$ sqlite3 -readonly <db> "select count(*) from session;"
117                                   # 提交前 116

$ sqlite3 -readonly -header -column <db> \
  "select id,title,directory,time_created from session order by time_created desc limit 3;"
id                              title            directory                       time_created
ses_e0bc97898ffe3NfF3EYllOYSgv  Agent Deck端到端测试  ~/TeleAgent  1795098576743
ses_e10a37c05ffe7H4fFCq1onkB4j  简短问候           ~/TeleAgent  1795017180154
...

$ sqlite3 -readonly <db> \
  "select json_extract(data,'$.type'), json_extract(data,'$.text') from part where session_id='ses_e0bc...' order by time_created limit 3;"
text        Agent Deck 端到端测试：回复收到
reasoning   用户发送了一条消息："Agent Deck 端到端测试：回复收到" ...
text        收到！主人，端到端链路通畅，消息我这边正常收到了。...
```

**自动认领校验（复用 `verifyDispatchedSession`）**：

```json
{"found": true, "id": "ses_e0bc97898ffe3NfF3EYllOYSgv",
 "title": "Agent Deck端到端测试", "created": 1795098576743,
 "db": "~/.local/share/TeleAgent/users/<ownerDir>/teleagent.db"}
```

- 该会话是 **Agent Deck 端到端测试**（标题即 `Agent Deck端到端测试`），按负责人要求**保留在账号里**，可自行删除。
- 端到端只点了一次；失败即停，没有循环灌任务。
- 之后已把用户 Edge 窗口恢复前台。

---

## 3. 通道 1：AT-SPI 无障碍树（装前对照）

### 3.1 结论

**当前不可用（缺系统包）**。第二轮结束时（22:00）仍未安装；本报告只记录**装前状态**作为对照，装包后的探测未执行。

### 3.2 原始命令与输出

```text
$ busctl --user status org.a11y.Bus
Failed to get credentials: No such device or address

$ gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus --method org.a11y.Bus.GetAddress
错误：GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown:
The name org.a11y.Bus was not provided by any .service files

$ dpkg -l at-spi2-core
un  at-spi2-core   <无>   (无描述)
$ ls -l /usr/libexec/at-spi-bus-launcher /usr/libexec/at-spi2-registryd
ls: 无法访问 '/usr/libexec/at-spi-bus-launcher': 没有那个文件或目录
ls: 无法访问 '/usr/libexec/at-spi2-registryd': 没有那个文件或目录

$ gsettings get org.gnome.desktop.interface toolkit-accessibility
false
```

GTK 应用侧证据（`zenity` 启动即报）：

```text
Gtk-WARNING **: Unable to acquire the address of the accessibility bus:
GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown:
The name org.a11y.Bus was not provided by any .service files.
If you are attempting to run GTK without a11y support, GTK_A11Y should be set to 'none'.
```

客户端具备 AT-SPI 能力（链接到了相关库）：

```text
$ ldd /opt/TeleAgent/teleagent | grep -Ei 'atk|atspi'
libatk-1.0.so.0, libatk-bridge-2.0.so.0, libatspi.so.0
```

包候选（只查本地元数据，未安装）：

```text
at-spi2-core        候选 2.59.1-2deepin1
gir1.2-atspi-2.0    候选 2.59.1-2deepin1
python3-pyatspi     候选 2.58.1-1
```

### 3.3 装包后的验证路径（**未执行，待实机确认**）

1. `at-spi2-core` 安装后，`org.a11y.Bus.GetAddress` 应返回 a11y 总线地址；用 `gdbus call --address=<addr>` 或 `busctl --address=` 连接（两者本机均支持）。
2. 让 Electron 打开无障碍：桌面启用 `toolkit-accessibility`，或客户端带 `--force-renderer-accessibility` 启动。
   ⚠️ 本 agent 环境 dconf 写入被只读挂载挡住（`unable to create file '/run/user/1000/dconf/user': 只读文件系统`），`gsettings set` 需在用户正常会话执行。
3. 用 `Atspi.get_desktop(0)`（需 `gir1.2-atspi-2.0`）或 gdbus 逐节点遍历，确认能否拿到 role/name、能否定位 Slate 编辑框与「运行」、能否读 enabled 状态。

### 3.4 无 root 方案评估（结论：不可行，未实测）

Lead 在工作区提供了 `dpkg -x` 解出的 at-spi rootfs（含 `at-spi-bus-launcher`、`at-spi2-registryd`、`accessibility.conf` 与 service 文件），但**不能在不装包的前提下拉起**：

```text
$ findmnt -no OPTIONS /usr
ro,nosuid,nodev,...            # /usr 是只读 overlay
$ strings temp/root/usr/libexec/at-spi-bus-launcher | grep -E 'accessibility.conf|dbus-daemon'
/usr/bin/dbus-daemon
--config-file=/etc/at-spi2/accessibility.conf
--config-file=/usr/share/defaults/at-spi2/accessibility.conf
```

- `at-spi-bus-launcher` 把配置路径与 `dbus-daemon` 路径**硬编码**；`/usr` 只读，无法放置 `/usr/share/defaults/at-spi2/accessibility.conf`。
- 手工绕过要自建 dbus-daemon、手写 `org.a11y.Status` root 属性、手动起 registryd，并让 Electron **重启**且带 `--force-renderer-accessibility` 才可能暴露树；这不是可交付的生产路径。
- 另外确认 DDE 没有可用的窗口激活 D-Bus 接口：`com.deepin.wm.service` 的 `Exec=/bin/false`（`dde-fakewm`），`org.deepin.dde.shell`/dock 只暴露 OSD 方法。

> **AT-SPI 结论：依赖 root 装包 + 客户端重启；本报告未实测，不外推。** 这是合规口径下的明确空白，不是“已验证不可用”。

### 3.5 风险（装包后仍存在）

- Chromium/Electron 在 Linux 上是否把树暴露出来**必须实测**，不能照搬 Windows UIA 的懒启用结论。
- AT-SPI 的 `EditableText.SetTextContents` 很可能和 Windows 的 `ValuePattern.SetValue` 一样**只改 DOM、不触发 React 状态**，仍需键盘/剪贴板提交。
- 界面文案选择器与 Windows 不同（Linux 输入框 placeholder、按钮可能是图标），需要重新采集。

---

## 4. 通道 3：本地端口、DevTools、深链

### 4.1 端口（应用运行中）

```text
$ ss -ltn | grep -E ':(4397|19876|8459|8388)\b'
LISTEN 0 4096 127.0.0.1:4397   0.0.0.0:*
LISTEN 0 4096 127.0.0.1:19876  0.0.0.0:*
# 8459、8388 不存在
```

```text
$ curl -sS -i http://127.0.0.1:4397/ready
HTTP/1.1 200 OK
Server: hertz
Super-Agent-Code-Version: dev-3.1.1-785b86
{"data":{"status":"ready"}}

$ curl -sS -i http://127.0.0.1:4397/
HTTP/1.1 401 Unauthorized
{"code":"local_auth_missing","message":"local_auth_missing"}

$ curl -sS -i http://127.0.0.1:19876/
HTTP/1.1 404 Not Found
404 page not found
```

- `4397` 是 Go 后端（客户端日志：`Go backend ready confirmed via HTTP http://127.0.0.1:4397/ready`）；`/ready` 无鉴权，业务面需 `local_auth`。
- **不猜 token、不读凭据、不枚举路径**，按合规口径排除该通道。
- `ss -ltnp` 的 Process 列为空：PID 命名空间隔离，看不到宿主进程；不影响“端口在听”的事实。

### 4.2 DevTools / CDP

```text
$ find ~/.local/share/TeleAgent ~/.config -name 'DevToolsActivePort*'
（空）
```

→ **未生成 `DevToolsActivePort`**，CDP 默认未开启。若要让 CDP 可用，需要用户以 `--remote-debugging-port` 重启客户端（会改变启动方式、扩大本地攻击面），本阶段未做。

### 4.3 深链 `teleai-cowork://`

```text
$ gio mime x-scheme-handler/teleai-cowork
用于“x-scheme-handler/teleai-cowork”的默认应用程序：teleagent.desktop
已注册的应用程序：teleagent.desktop

$ cat /usr/share/applications/teleagent.desktop
Exec=/opt/TeleAgent/teleagent-launcher %U
MimeType=x-scheme-handler/teleai-cowork;
```

单实例转发有日志证据：

```text
[2026-11-19T09:00:26.753Z] [INFO] [Main]  Second instance detected, focusing existing window
[2026-11-19T09:00:26.755Z] [INFO] [Main]  Asking renderer to reopen the login flow
```

→ scheme **已注册**、`%U` 会传参、客户端有单实例转发；**“唤起后是否带参建任务/切页面”未实测**（本轮刻意没有触发，避免把用户界面切到登录/其它页面）。

### 4.4 通道 3 结论

- 端口/HTTP：**存在但不可用**（私有协议 + 本地鉴权 + 无文档）。
- CDP：**当前不可用**；如用户接受调试启动，可作为最强通道单独立项。
- 深链：**注册面可用，行为待验证**；在验证前只能作为“唤起客户端”的兜底。

---

## 5. 推荐实现方案

### 5.1 分层

```
capability probe（依赖/窗口/登录态）
  └─ 主通道：AT-SPI（语义定位 + 可读状态）
       └─ 降级：xdotool（合成器级激活 + 鼠标 + 剪贴板粘贴）
            └─ 兜底：唤起客户端 + 剪贴板（人工确认）
动作完成后统一：SQLite 只读回读
```

### 5.2 主通道：AT-SPI（先装包做可行性验证）

- 依赖：`at-spi2-core`（+ 建议 `gir1.2-atspi-2.0`）。
- 启动：TeleAgent 以 `--force-renderer-accessibility` 启动（launcher 会透传参数），或系统启用 a11y。
- 实现形态：`src/teleagent-dispatch-linux.js` + 一个 helper（Python/`gi.repository.Atspi` 或 gdbus），对齐 Windows 的“PowerShell helper”结构；复用 `DISPATCH_STAGES` 与 `runHandoffDispatch` 闸门。
- 动作顺序：找「新建任务」→ 项目选择器 → 只读校验执行模式/模型 → 聚焦输入框 → 文本写入（优先剪贴板/键盘）→ 点「运行」。
- 最大优势：**能读控件状态**（enabled/selected），这是 xdotool 做不到的。

### 5.3 降级：xdotool（窗口操作已实测，文本需剪贴板）

实现要点（**基于本轮实测，不是推测**）：

1. **窗口定位**：`xdotool search --class teleagent`，取标题含「TeleAgent 星辰超级智能体」的主窗；辅助窗（Screenshot/10×10）要排除。
2. **前台/焦点**：不要用 `windowactivate`；用 **treeland 原生 `treeland_foreign_toplevel_manager_v1`** 的 `activate(handle, seat)`（需要一个小的 Wayland helper；本轮用 `tl-act` 验证）。激活后校验 `xdotool getwindowfocus` == 主窗 id，失败即中止。
3. **文本**：**不要逐字符打字**（字母被 IME 组合）。**已实测可用**：把文本写入剪贴板（用户级 `xclip`），点输入框后 `Ctrl+V`，截图确认输入框出现原文；清理用 `Escape + Ctrl+A + Delete/Backspace`。生产可考虑用 Obsidian 自带 Electron `clipboard` 替代 `xclip`（未验证，见 §5.8）。
4. **按钮**：优先键盘（Tab 定位）或按已知几何点击；`运行` 按钮的坐标在 Linux 版尚未采集（本轮禁止点它）。
5. **恢复**：动作完成后把用户原来的窗口（如 Edge）重新 activate，避免一直占前台。

### 5.4 兜底：唤起 + 剪贴板

- `xdg-open teleai-cowork://...` 或直接 spawn launcher 唤起（行为待验证），把派发文本放入剪贴板，提示用户粘贴发送。
- 必须返回 `ok:false`/`stage:"manual"` 之类的诚实结果，不能把“已复制”说成“已派发”。

### 5.5 依赖清单

| 依赖 | 状态 | 用途 |
| --- | --- | --- |
| `xdotool` | **已装** 3.20160805.1 | 窗口/键鼠注入（X11） |
| `at-spi2-core` | **缺**，候选 2.59.1-2deepin1 | AT-SPI 总线/registryd（主通道） |
| `gir1.2-atspi-2.0` | **缺**，候选同上 | Python Atspi 探树（可选，gdbus 可替代） |
| `python3-pyatspi` | **缺**，候选 2.58.1-1 | 可选 |
| `xclip` | **本轮可用**：工作区 `temp/root/usr/bin/xclip` 0.13（`dpkg -x` 解出，非系统安装、GPL） | X11 剪贴板；**生产可用性见 §5.8** |
| `wl-clipboard` | **缺**，候选 2.0.0-1 | Wayland 原生剪贴板（仅 `KEEP_WAYLAND` 时需要） |
| treeland 协议 helper | **需自建/内置** | 合成器级窗口激活（窗口已在 X 树，但 `windowactivate` 无效） |
| `ydotool` | **无候选** | 不可用 |
| `wtype` | **缺**，候选 0.4-3 | 仅 Wayland 原生场景 |

### 5.6 代码落点建议（下一阶段）

1. `src/teleagent-dispatch.js` 保持 Windows 实现；新增 `src/teleagent-dispatch-linux.js`（同 stage 枚举）。
2. `runHandoffDispatch` 平台闸门：`linux → capability probe`（AT-SPI bus/包、X 窗口、treeland 激活 helper、剪贴板工具），缺依赖时返回结构化 `stage:"deps"`，**不要让用户点到一个必然失败的菜单项**。
3. `src/main.js` 约 2454 行的 `process.platform === "win32"` 改为“平台能力探测通过才显示”。
4. 项目目录校验：Linux 库 `directory` 是绝对路径（本机看到 `~/TeleAgent`），`resolveProjectForTask` / `verifyDispatchedSession` 需要 Linux 分支，不能假设 `E:\...`。
5. 失败口径：每步返回 `stage + error`；提示文案区分“已派发并确认落库 / 已发送但本地库未查到 / 仅复制未发送”。

### 5.7 风险表（本轮新增/确认）

| 风险 | 实测状态 | 缓解 |
| --- | --- | --- |
| Wayland 聚焦 | **已确认**：`windowactivate`/`_NET_ACTIVE_WINDOW` 无效；treeland 原生协议可激活 | 内置 treeland helper；激活后校验 `getwindowfocus` |
| 输入法吞字母 | **已确认**：字母被组合，数字/ Tab 正常 | 剪贴板粘贴；不要逐字符打字 |
| 输入框是 Slate | 与 Windows 同类；直接文本接口可能不触发 React | 以粘贴/键盘为准，最终用 SQLite 回读 |
| 登录态 | 当前**已登录**（主界面、任务列表、头像「<用户名>」），非登录页；17:00 日志的 `isLoginSuccess:false` 是历史运行 | 派发前探测登录页；失败给 `stage:"login"` |
| 单实例 | 日志证明第二实例会 focus 已有窗口 | 需要调试参数时要求先退出客户端 |
| 选择器文案 | Linux 版界面文案与 Windows 不同（如发送按钮是纸飞机图标） | selector 集中成表、失败即报 stage |
| 坐标点击 | 1920×1080、窗口 1513×1005；本轮已验证坐标换算 | 优先键盘；坐标点击前先取几何并校验 |
| 数据面路径 | Linux 绝对路径 | 回读按绝对目录 + 时间 + 正文前缀匹配 |
| 抢占用户前台 | 本轮激活测试遮挡了用户 Edge（已恢复） | 维持“人在场的一次一条”，动作后恢复焦点 |

### 5.8 生产可行性：能否只用 xdotool + xclip + 用户级无依赖？

**分三段回答（都有本轮实测依据）：**

1. **文本 + 点击：可以。** `xclip` 写剪贴板（用户级、无需 root）→ 点输入框 → `Ctrl+V` → 截图确认中文原文；`xdotool` 点击、Tab、数字键均有效。
2. **自动抢前台：不可以。** treeland 下 `windowactivate`/`_NET_ACTIVE_WINDOW` 对 TeleAgent 无效；DDE 没有可用的窗口激活 D-Bus（`com.deepin.wm` 的 `Exec=/bin/false`，shell/dock 只有 OSD）。要么：
   - **A. 人在场的两段式**：用户先把 TeleAgent 切到前台，插件再执行“点输入框 → 粘贴 → 点运行 → SQLite 回读”。零原生依赖，但不是“一键”。
   - **B. 内置 treeland 原生 helper**（≈ 本轮的 `tl-act`）：`treeland_foreign_toplevel_manager_v1` 的 `activate(handle, seat)`，需随插件分发对应架构的 native 二进制，并接受 Wayland 协议绑定/构建成本。这才是真正的“一键”。
3. **依赖洁癖：xdotool / xclip 都不是“零依赖”。** 
   - `xclip` 是 GPL，随 Apache-2.0 插件分发需评估许可与体积；更干净的做法是用 **Obsidian 自身的 Electron `clipboard`** 写系统剪贴板（省掉 xclip），但**未在 Obsidian 内实测**。
   - `xdotool` 也需系统安装或随插件分发；缺失时应直接降级为“唤起 + 复制 + 人工粘贴”，不能假装成功。

**结论**：**“用户已把 TeleAgent 放前台 + 本机有 xdotool” → 可全自动填词、点击并从 SQLite 回读；做不到“零依赖、自动抢前台的一键”。** 要真正一键，必须额外做 treeland helper（或等桌面提供窗口激活 API）。

### 5.9 坐标点击稳定性与“兜底杀停”建议

当前 `1513×1005+176+40` 只是用户当前窗口状态；最大化、缩放、改分辨率、多屏、主题都会变，**不能硬编码绝对坐标**。建议：

1. **运行时取几何**：`xdotool getwindowgeometry --shell` 得到 W/H/X/Y，按**窗口相对比例**定位（例如输入框 `0.46W, 0.78H`，发送按钮 `0.90W, 0.88H`）；比例在参考尺寸上标定，允许 ±3% 容差。
2. **尺寸 sanity**：`W∈[1200,2000]`、`H∈[800,1300]`、宽高比 `1.35–1.65`；超出范围直接 `stage:"layout"` 中止，不点。
3. **前置焦点校验**：必须 `xdotool getwindowfocus == 主窗 id`（或合成器 `act=yes`）；否则 `stage:"focus"` 中止，绝不盲点。
4. **点击后校验**：截取输入框区域，确认焦点环/光标出现；没有则中止。
5. **粘贴后校验**：截图确认占位符消失/发送按钮变色（至少证明输入框非空）；否则不得提交。
6. **草稿风险**：xdotool 读不到用户是否已有草稿。建议派发前先走「新建任务」进入空 composer（需产品确认是否允许丢弃当前草稿），或要求用户确认；**任何不确定都杀停**，宁可让用户手点一次，也不要把任务发错内容。
7. 把上述坐标表放进 selector 表；插件启动时做一次几何/窗口自检，不通过就不显示“派发”菜单项。
8. **已验证的提交坐标**：窗口内 `(1358, 897)`，即比例 `(0.8976, 0.8925)`；点击前必须同时满足：`getwindowfocus == 主窗 id`、发送按钮区域蓝色像素 ≥ 50（本机实测 614）、输入框截图非空。该比例在 1513×1005 上验证通过；窗口大小/缩放变化时仍按比例换算并重新做上述校验。

---

## 6. 与 Windows UIA 的能力对等矩阵

> Windows 列来自 `docs/specs/teleagent-uia-automation.zh-CN.md` 的既有实测；Linux 列只写本轮实测，未测一律“未验证”。

| 能力 | Windows UIA | Linux AT-SPI | Linux xdotool | 深链 |
| --- | --- | --- | --- | --- |
| 自动建任务（点「新建任务」） | ✅ InvokePattern | 未验证 | 机制上可点（鼠标点击已实测）；坐标/按钮名未采集 | 未验证 |
| 选项目 | ✅ ExpandCollapse + Invoke | 未验证 | 未验证（下拉交互未测） | 未适用 |
| 校验执行模式 / 模型（只读） | ✅ SelectionItem / ToggleState | 未验证 | ❌ 读不到状态（界面可见「默认权限」「旗舰」） | 不适用 |
| 填文本（含中文） | ✅ SetFocus + SendInput(UNICODE) | 未验证（EditableText 可能不触发 React） | ✅ **剪贴板 + Ctrl+V 实测**（含中文）；直接打字 ❌（字母被 IME 组合） | 不适用 |
| 点「运行」 | ✅ InvokePattern | 未验证 | ✅ 比例坐标 + 焦点/蓝色像素校验；2026-11-19 22:29 一次真实提交成功 | 不适用 |
| 读「运行」enabled | ✅ IsEnabled | 未验证（AT-SPI 可读 State） | ❌ 不可行 | 不适用 |
| 回读确认（SQLite） | ✅ 已实现 | ✅ 只读可用（本机实测） | ✅ 同左 | ✅ 可兜底 |
| 抬到前台 | 不适用（UIA Invoke 不要求前台） | 未验证 | ✅ 需 treeland 协议；`windowactivate` 无效 | ✅ 唤起即前台 |

---

## 7. 未验证项（单列，禁止外推）

1. **AT-SPI**：**依赖 root 装包 + 客户端重启；本报告未实测，不外推**（无 root 方案已评估为不可行，见 §3.4）。
2. **字母文本被吞的确切归属**：行为与 IME 组合一致（数字通过、字母不出、空格提交中文），但 `fcitx5-remote` 状态为 `1`；不排除 Electron 的 GTK IM 模块本身。剪贴板路径已证明可用，但仍未定位具体组件（fcitx daemon vs GTK IM）。
3. **剪贴板粘贴链路**：已用工作区 rootfs 的 `xclip 0.13` 实测通过（中文可粘贴）；但 **`xclip` 非系统安装、GPL**，生产是否随插件分发/改用 Obsidian Electron clipboard 未定、未验证。
4. **进程激活**：生产若不做 treeland helper，就只能依赖“用户先把 TeleAgent 放前台”；该两段式流程未做产品验证。
5. **坐标稳定性**：窗口最大化/缩放/多屏/DPI 变化下的相对坐标未实测，仅给出比例与杀停建议（§5.9）。
6. **「运行」按钮**：已在 2026-11-19 22:29 获批准实测一次并成功（比例坐标 + 校验，见 §2.9）；生产默认仍不自动提交，直到用户明确同意。
7. **项目选择器/执行模式/模型选择器**：界面可见但未操作、未读状态。
8. **深链唤起与带参**：未实测。
9. **`TELEAGENT_KEEP_WAYLAND=1`（Wayland 原生）模式**：未实测；按 xdotool 只连 X 客户端的事实该模式不可见，但不写成已验证结论。
10. **HiDPI/多屏**：未验证（本机 1920×1080、单屏）。
11. **4397 私有 HTTP API 的完整能力**：按合规口径未深入。
12. **登录态探测方式**：当前是已登录主界面；如何在自动化里可靠区分登录页未设计。
13. 本报告不涉及 macOS；不把 Linux 结论外推到 Windows/macOS。

---

## 8. 复现与产物

### 8.1 原始命令（关键片段已在各节给出）

```bash
# 窗口
DISPLAY=:1 xdotool search --class teleagent
DISPLAY=:1 xprop -id 18874386 WM_CLASS WM_NAME _NET_WM_PID
DISPLAY=:1 xwininfo -id 18874386
DISPLAY=:1 xdotool getwindowgeometry --shell 18874386

# 合成器级激活（需先构建 tl-act；见 §8.2）
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=treeland.socket ./tl-act -a "TeleAgent 星辰"
DISPLAY=:1 xdotool getwindowfocus

# 界面截图（X 窗口，即使被遮挡也可取）
DISPLAY=:1 import -window 0x1200012 out.png

# 合成器截屏（判断谁在最前面）
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=treeland.socket ./wpe-shot -o screen.ppm

# 端口/深链
ss -ltn | grep -E ':(4397|19876|8459|8388)\b'
curl -sS -i http://127.0.0.1:4397/ready
gio mime x-scheme-handler/teleai-cowork
```

### 8.2 本轮构建的只读工具（在 `temp/probe/`，未提交）

- `temp/probe/shot/wpe-shot`：`zwlr_screencopy_manager_v1` 截屏客户端（源码/协议头来自本机既有 skill 与旧项目，未改动系统）。
- `temp/probe/tl/tl-act`：基于 `treeland_foreign_toplevel_manager_v1` 的窗口列表/激活工具（源码基于既有 `wpe-tl.c`，增加了按标题激活）。
- `temp/probe/shots/`：本轮截图证据（`screen.png` 显示 Edge 全屏在前；`screen-after-act.png` 显示 TeleAgent 被激活；`test-123.png` 显示数字输入成功；`type-window.png` 显示 IME 提交的中文；`clear3.png` 显示最终清空；`paste-before.png` / `paste-after.png` / `paste-cleared.png` 是第三轮剪贴板粘贴“前/后/清空”的完整证据）。
- `temp/root/usr/bin/xclip`：Lead 提供的用户级 `xclip 0.13`（从 deepin 包 `dpkg -x` 解出，GPL；**仅用于取证，不代表生产可依赖**）。
- `temp/probe/xev.log`、`xev-click.log`：第一轮 X11 键鼠注入的原始事件。
- 数据库始终以 `file:...?mode=ro` 只读打开。

### 8.3 下一步（需用户/Lead 决策）

1. **AT-SPI**：结论已是“依赖 root 装包 + 客户端重启，未实测”；若负责人后续愿意 root 安装，再做装后对照（装前基线已留）。
2. **剪贴板**：用户级 `xclip` 路径已验证；生产下一步是验证替代方案——用 Obsidian 自身的 Electron `clipboard` 写剪贴板（省掉 GPL 的 xclip）。
3. **产品形态二选一**：A. 人在场两段式（用户先把 TeleAgent 放前台，零原生依赖）；B. 内置 treeland 原生 helper 实现自动抢前台（真一键，但需分发 native 二进制）。
4. 是否允许采集「运行」按钮的坐标/名称（只观察不点击），以便补全矩阵。
5. 是否允许做一次**不提交**的深链唤起测试（会把客户端切到对应页面，可能触发登录流）。
