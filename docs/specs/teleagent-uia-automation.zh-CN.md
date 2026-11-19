# TeleAgent 界面自动化（Windows UI Automation）可行性与实测

> 状态：**探测层与完整动作流程均已实测通过**（2026-11-19，分支 `feat/teleagent-adapter`）——§6 记录了一次真实的「新建任务 → 选项目 → 输入 → 运行」端到端执行。核验环境：Windows 11 + TeleAgent 桌面版 **3.1.0**（Electron **43.1.0**，`appUserModelId=com.teleai.superagent`，安装于 `D:\Program Files\TeleClaw\TeleAgent`）。**macOS / Linux 未实测**，按 AGENTS.md 口径不外推。
>
> 与 [`teleagent-adapter.zh-CN.md`](teleagent-adapter.zh-CN.md) 的分工：那份定义**只读数据契约**（直接读 `users/<owner>/teleagent.db`，客户端关着也能追踪）；本文定义**界面操作通道**（驱动正在运行的桌面客户端）。两者互不替代：数据面负责“看历史”，界面面负责“点按钮、发消息”。

## 0. 结论

- **可以**。TeleAgent 用 Electron 打包，Chromium 自带 Windows **UI Automation**（下称 UIA，微软的跨进程无障碍接口）提供程序，整个网页界面会作为标准 UIA 元素树暴露给外部程序，**应用侧零改造、不需要插件、不需要重启带调试参数**。
- 本机实测：主窗口 **331** 个可访问元素（Button 159 / Text 91 / Group 65 / Pane 9 / Image 5 / Document 1 / Edit 1），全量遍历 **99 ms**；按钮 `Name` 直接是中文业务文案，聊天输入框 `ValuePattern` **可读可写**（已做写入→读回→还原的可逆验证）。
- 最大成本项不是“能不能访问”，而是 **`AutomationId` 全为空、定位只能靠 `ControlType + Name + 层级`**，而 `Name` 是界面文案——客户端每次版本升级改一句文案，定位就会失效。
- 结论性定位：UIA 适合做**兜底通道**（发消息、点菜单这类低频动作）；状态回读优先走数据面（SQLite）与宠物窗文本，不要用元素树高频轮询。

## 1. 已核验的环境事实

| 项 | 实测结果 |
| --- | --- |
| 进程形态 | 主进程 `TeleAgent.exe --updated`（本例 PID 17932）；子进程含 1 个 crashpad、4 个 utility、3 个 renderer、1 个 gpu-process |
| 内核 | `%LOCALAPPDATA%..\.local\share\TeleAgent\runtimes\super-agent-code\bin\TeleAgent.exe`（独立进程，非 Electron 子进程） |
| 顶层窗口 | `Chrome_WidgetWin_1` 两个：主界面 `TeleAgent 星辰超级智能体`，桌面宠物 `小豆子` |
| 元素树规模 | 主窗 331 节点、遍历 99 ms；宠物窗 13 节点 |
| `AutomationId` | 绝大多数为空，仅 `RootWebArea`、`root` 等容器有值 |
| 按钮模式 | `InvokePattern` + `ScrollItemPattern`；`GetClickablePoint()` **抛异常**（未实现），`BoundingRectangle` 精确可用 |
| 输入框 | 1 个 `Edit`，实为 Slate 富文本区（class 含 `data-slate-placeholder`），`ValuePattern` / `TextPattern` / `ScrollItemPattern`，`IsReadOnly=False` |
| DevTools 远程调试（CDP） | **未开启**：无 `DevToolsActivePort` 文件，所有进程命令行无 `--remote-debugging-port` |
| 本地 HTTP 端口 | `127.0.0.1:8459`（主进程）、`127.0.0.1:4397` 返回 `401 {"message":"Unauthorized"}`；`127.0.0.1:19876`（内核）返回 `404` |
| 数据根 | `%USERPROFILE%\.local\share\TeleAgent`（含 `teleagent.db`、`channel-config.json`、`current-owner.json` 等） |

## 2. 机制：为什么“不用改应用也能访问”

Chromium 的无障碍能力是**懒启用**的：默认渲染进程不构建无障碍树；当系统的 UIA 客户端（`UIAutomationCore`）向窗口发送 `WM_GETOBJECT` 请求时，渲染进程才打开原生无障碍支持、把 DOM 树投影成 UIA 树并持续同步。

实测证据：第一次对宠物窗调用 `FindAll` 只返回 **9** 个后代元素，紧接着第二次调用变成 **13** 个；引擎被唤醒后再查主窗口，一次即拿到完整 **331** 个。引擎一旦唤醒就常驻（`accessibilityModeEnabled`），不会每次重连都重新预热。

**对适配器的直接约束**：`Attach → 立刻断言找不到元素` 是错误写法，必须留一次重试或轮询窗口。Electron 侧也可用 `app.setAccessibilitySupportEnabled(true)` 或启动参数 `--force-renderer-accessibility` 强制开启，但本应用**不需要**。

## 3. 定位与操作原语（已验证的写法）

```powershell
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]

# 1) 按进程枚举顶层窗口，用标题筛主界面（不要用 MainWindowHandle，会随机落到宠物窗）
$pids = (Get-Process TeleAgent).Id
$wins = $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,
         [System.Windows.Automation.Condition]::TrueCondition)
$main = $null
foreach ($w in $wins) {
  if ($pids -contains $w.Current.ProcessId -and $w.Current.Name -like 'TeleAgent*') { $main = $w }
}

# 2) 按 ControlType + Name 组合定位
$cond = New-Object System.Windows.Automation.AndCondition(
  (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty,
     [System.Windows.Automation.ControlType]::Button)),
  (New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, '新建任务'))
)
$btn = $main.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
$btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()

# 3) 写输入框（读、写同一个 ValuePattern）
$editCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty,
              [System.Windows.Automation.ControlType]::Edit)
$edit = $main.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCond)
$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('测试文本')
```

四个原语（适配器应只暴露这四层，不把 TeleAgent 细节泄到公共层）：

| 原语 | 实现要点 |
| --- | --- |
| `find(role, name, scopePath)` | 优先 `BoundingRectangle` 所在容器做局部 `FindAll`；内置懒启用预热 + 重试 |
| `read()` | 按容器 `Group` 归并 `Text` 子节点；单节点不等于整条消息 |
| `click(elt)` | 优先 `InvokePattern`（不抢前台焦点）；退化到 `BoundingRectangle` 中心点 `SendInput` |
| `write(text)` | **键盘注入优先**，`SetValue` 只作兜底（见 §4.4） |

## 4. 已确认的坑

### 4.1 `AutomationId` 缺失，定位绑死界面文案

整棵树里 `AutomationId` 基本为空。可读到的按钮名举例（真实采集）：

```
Button '新建任务'                 Button '技能·专家·应用连接'
Button '定时任务'                 Button '即时通讯'
Button '移动端连接'               Button '收起置顶'
Button '筛选'                     Button '展开全部'
Button 'management-revised (2)'   Button '数字员工劳动竞赛 (2)'
Button '更多操作'                 Group  '任务列表'
```

界面文案随版本与语言切换变化（本机 `--lang=en-US` 但界面为中文），因此 **selector 必须集中成表并支持热修**，不能散落在业务代码里。

### 4.2 虚拟列表只暴露已渲染行

任务列表需点“查看更多”才加载更多分组，长会话需滚动才渲染历史消息。**“找不到”不等于“不存在”**，任何否定断言都必须先驱动滚动/展开。

### 4.3 文本被切碎

一条消息气泡会拆成多个 `Text` 节点（标题、正文、行内代码各一个），且有行内代码时正文被截成 `结构没问题。第 5 步：改 ` / `，领导邮件跳过两个归档分支。` 两段。还原整段必须按父容器 `Group` 归并。

### 4.4 `ValuePattern.SetValue` 写入无效，必须走键盘

**已实测（2026-11-19）**：对输入框调用 `SetValue('UIA-SetValue-探针')` 后，`ValuePattern` 能读回该文本（DOM 确实变了），但**「运行」按钮仍是 `IsEnabled=False`**；把值清空再改用 `SendInput` 逐字符注入 `请发送你好`，同一按钮立刻变为 `True`。

结论：Slate 富文本只认 `beforeinput`/`input` 事件链，`SetValue` 绕过 React 状态，**只能改 DOM、不能真正提交**。写入必须用 `SetFocus()` + `SendInput` 且 `KEYEVENTF_UNICODE`（中文直出、不需要输入法），见 §6.2 第 8 步。

### 4.5 「运行」按钮的 `IsEnabled` 是输入已提交的可靠信号

空输入 `False`、有效输入 `True`。它比“读回输入框文本非空”更可靠（后者会被 `SetValue` 伪造），因此适配器应把这个状态当作 **“可以提交了吗”的判据**，提交后再观察它回落为 `False`。

### 4.6 权限与焦点

- 若 TeleAgent 以管理员启动，非提权的自动化进程会被 UIPI 拦截（**未实测**，按 Windows 常规行为记录）。
- 坐标点击要求窗口未被遮挡、未最小化；`InvokePattern` 不要求前台，更适合无人值守。
- 开启无障碍后引擎常驻，有少量内存/渲染开销，对日常使用基本无感。

### 4.7 高 DPI

`BoundingRectangle` 为桌面坐标系的物理像素；本机 100% 缩放。**非 100% 缩放未实测**，坐标点击前需换算。

## 5. 四条路线的取舍

| 路线 | 现状 | 能力上限 | 主要代价 |
| --- | --- | --- | --- |
| **UIA** | 立即可用，零改造 | 读元素、读写文本、点按钮 | 文案一变就断；无语义 API；全树轮询贵 |
| **CDP**（Chrome DevTools Protocol） | 未开；需 `--remote-debugging-port` 重启 | 完整 DOM、任意 JS、网络拦截 | 需控制启动参数；自动更新与单实例锁会干扰 |
| **本地 HTTP 接口** | `8459`/`4397` 存在但 401 鉴权 | 若有正式接口最稳 | 私有协议、无文档、需凭据（敏感，需显式授权） |
| **数据面只读** | 已实现（见 `teleagent-adapter.zh-CN.md`） | 看会话/消息/token | 只读，不能操作界面 |

**推荐组合**：数据面做状态与历史的主通道；UIA 只做“动作执行”（新建任务、发消息、点确认），“看结果”尽量回到数据面；宠物窗文本作为轻量状态信号。

## 6. 端到端流程实测（新建任务 → 选项目 → 输入 → 运行）

**执行时间 2026-11-19 18:06，TeleAgent 3.1.0，全程 UIA 驱动，人工只做观察。** 目标：在项目 `jifang_data_analysis` 下新建任务，保持「默认权限 + 旗舰」不变，发送文本「请发送你好」。

### 6.1 逐步 selector 与必需模式

| 步 | 目标元素 | 定位方式 | **必需模式** | 实测结果 |
| --- | --- | --- | --- | --- |
| 1 | 侧栏「新建任务」 | `ControlType=Button` + `Name=新建任务`，取首个（rect 372,180） | `InvokePattern` | 进入撰写面板，元素树 328 → 232 |
| 2 | 项目选择器当前值 | `Button` + `Name=TeleAgent的工作空间`（rect 825,703） | `ExpandCollapsePattern.Expand()` | 展开「当前 / 最近」列表，新增 46 个节点 |
| 3 | 项目项 `jifang_data_analysis` | `Button` + `Name=jifang_data_analysis`，用 rect 落在下拉区（842,590）筛掉侧栏同名项 | `InvokePattern` | 选择器回显变为 `jifang_data_analysis` |
| 4 | 执行模式 | `Button` + `Name=执行模式` | `ExpandCollapsePattern` | 展开出 2 个 `RadioButton` |
| 5 | 权限项校验 | `RadioButton` `默认权限 推荐` / `全自动执行 高风险` | `SelectionItemPattern.IsSelected` | 默认权限 = `True`，**无需改动** |
| 6 | 模型选择器 | `Button` + `Name=选择模型` | `ExpandCollapsePattern` | 展开出 3 个 `Toggle` 按钮 + `模型设置` |
| 7 | 模型项校验 | `Button` `智能…` / `旗舰…` / `极速…` | `TogglePattern.ToggleState` | 旗舰 = `On`，**无需改动** |
| 8 | 输入框 | 唯一 `ControlType=Edit`（rect 676,737，798×50） | `SetFocus()` + `SendInput`（`KEYEVENTF_UNICODE`） | 读回 `请发送你好` |
| 9 | 「运行」 | `Button` + `Name=运行`（rect 1418,815） | `InvokePattern` | 发送成功 |

### 6.2 三个必须记住的坑

1. **下拉类控件全部是 `ExpandCollapsePattern`，不支持 `InvokePattern`**。对「运行环境 / 执行模式 / 选择模型 / 添加」调用 `Invoke` 会直接抛「不支持的模式」。适配器不能对所有 Button 统一 `Invoke()`，要先查 `GetSupportedPatterns()` 再分发。
2. **同名元素必须靠坐标/容器消歧**。`jifang_data_analysis` 同时存在于左侧任务列表（rect 372,1655）和下拉浮层（rect 842,590），只按 `Name` 取首个会点到侧栏的展开按钮。
3. **选项的选中状态读模式，不要读 `Value`**。`RadioButton` 的 `ValuePattern.Value` 实测为空串，真假在 `IsSelected`；`Toggle` 按钮的真假在 `ToggleState`。

### 6.3 时间线与跨通道校验

```
18:06:21  Invoke「运行」
18:06:22  用户消息出现在会话区（时间戳 2026-11-19 18:06:22）
18:06:32  assistant 回复完成
```

同一时刻只读 `users/<owner>/teleagent.db` 交叉验证：

- `session` 新增 `ses_e0cba7c0affeOj6SQhrXBx0pe2`，`title=问候`，`directory=E:\Project_test\jifang_data_analysis`，`time_created=18:06:21`；
- `part` 中 `type=text` 依次为「请发送你好」与回复正文。

→ **界面动作与数据面记录一一对应**，因此“动作是否真的落地”可以用 SQLite 回读来验证，不必依赖截图。注意 `message` 表**没有 `role` 列**，角色在 `data` JSON 里。

另注：任务标题由客户端自动生成（本例据首条消息生成「问候」），不是输入原文，适配器不要用标题反推输入。

### 6.4 一个语义层面的观察

输入「请发送你好」后，模型**没有真的外发**，而是先追问「要发到哪个渠道（量子密信群 / 微信群 / 邮件）」。说明这类对外动作需要显式目标；脚本化时应把目标写进指令，否则任务会停在澄清状态，看起来“发了但没效果”。

## 7. 「小豆子」宠物窗是状态通道

宠物窗是**独立的顶层窗口**（`Chrome_WidgetWin_1`，本例 480×480，rect 坐标为负即贴在屏幕边缘），元素极少（13 个节点），所以读取成本远低于主窗。

实测文本序列（同一轮任务）：

| 阶段 | 宠物窗文本 |
| --- | --- |
| 空闲 | `答案在路上，别催喵` |
| 思考 / 执行中 | `脑子里过一遍，马上`（伴随 `❓` 图标） |
| 完成 | `呼——干完了，🎉` |

用法与边界：

- **适合**做“任务在跑 / 已结束”的轻量信号，替代对主窗整棵元素树的高频轮询。
- **不适合**当事实来源：文案是拟人化口播，随版本与皮肤变化；不含任务 id、不含进度细节；多任务并发时无法区分是哪一个任务。
- 用户经验补充（**本轮未复现**，标注为待验证）：这里会显示「等待审批」这类关键状态。若成立，适配器应把宠物窗文本纳入监听，并对「等待审批 / 需确认 / 需介入」等关键词直接告警——这类状态往往是自动化链路唯一会“卡住”的地方，主窗此刻可能只是安静地停着。

## 8. 任务列表的定位与导航（如何找到刚建的会话）

实测（2026-11-19 18:10，紧接 §6 那条任务）：

- 新建任务后，侧栏分组头从 `jifang_data_analysis (8)` 变成 `(9)`，新条目出现在该组**首位**，**不需要**点“查看更多”。
- 条目本身是 `Button` + `Name=<会话标题>`，支持 `InvokePattern` + `ScrollItemPattern`。
- **条目默认在视口外**：rect `(392,1695)`、`IsOffscreen=True`，而窗口可视区是 `Y 116..924`、列表容器自身高 1529。必须 `ScrollItemPattern.ScrollIntoView()` 才真正可见——实测滚动后变为 `(392,588)`、`IsOffscreen=False`。所以“找不到”之前必须先滚，任何否定断言都要先 `ScrollIntoView`。
- **滚动容器不暴露 `ScrollPattern`**：`Group '任务列表'`（205×1529）只支持 `ScrollItem`，没有 `VerticalScrollPercent`。要滚动只能靠条目自身的 `ScrollIntoView()`，或往列表内发滚轮事件。
- **分组头的计数是动态的**：任务一增一减就变 `(N)`。定位必须用前缀或正则 `^<项目名> \(\d+\)$`，**全等匹配会在下一次建任务后失效**。

定位链（实测解出的层级）：

```text
Group '任务列表'  (372,392) 205×1529
└─ Button 'jifang_data_analysis (9)'                      ← 分组头，正则匹配
   ├─ Button '新建任务'  /  Button '更多操作'                ← 组级操作
   └─ Group (380,<y>) 197×36                               ← 每个会话条目一层
      ├─ Button '<会话标题>'   ← 点击目标（InvokePattern）
      ├─ Text   '已完成' | '运行中' | '需介入' | '已暂停'    ← 会话状态
      └─ Button '更多操作'
```

三个使用约束：

1. **界面上没有文本搜索框**：`筛选` 是下拉筛选器，不是关键字检索。“搜会话”实际上只能遍历元素 `Name` 做全等/包含匹配。
2. **同名会话会撞车**：只按 `Name` 取首个可能点到别处，必须用“分组头 → 组内条目”的路径定位，必要时再用 `BoundingRectangle` 消歧。
3. **稳定索引在数据库**：`session.id / title / directory / time_created`。推荐流程是 **数据库算出目标会话 → 界面按标题在对应分组内定位并 `Invoke`**，而不是靠界面标题猜。

## 9. 派发（委派）能力的边界

技术上已经具备完整闭环：**新建任务 → 选项目 → 校验权限/模型 → 输入 → 运行 → 数据库回读校验**（§6 已实测通过）。但这不等于可以拿去做后台编排，有三个硬约束：

1. **必须抢焦点。** `ValuePattern.SetValue` 已证明无效（§4.4），只能用 `SendInput` 往最前台窗口打字。派发期间窗口会被置前并占用键盘，用户无法同时使用电脑；批量派发等于劫持桌面。
2. **会停在等待审批。** 默认权限下高影响动作要人工确认，任务会挂在那里。本轮未复现（该文本待验证），但对“无人值守”是致命点——主窗此刻可能安静地停着，只有宠物窗（§7）会给出信号。
3. **selector 绑死文案。** 没有 `AutomationId` 兜底，客户端改一句界面文案就要改 selector 表，而 TeleAgent 更新频繁（本文所有采集都是 3.1.0 一次快照）。

结论：这套能力适合定位为 **“人在场的一键派发”**——用户点一次，脚本前台执行一条、并用数据库确认落地；**不适合当作后台批量编排通道**。这与 [`teleagent-adapter.zh-CN.md`](teleagent-adapter.zh-CN.md) 的 `desktopHandoffOnly` 定位不冲突，只是把“复制交接”升级成“一键落地”。

### 9.1 决策记录（2026-11-19）

用户选定范围：**人在场的一键派发**。据此确定：

- **做**：Windows 上把“复制任务文本 + 唤起客户端”升级为“前台新建任务 → 选项目 → 校验默认权限/旗舰 → 填入 → 运行 → SQLite 回读校验”。
- **不做**：无人值守批量派发、后台队列、并发派发。
- **前置校验不可省**：派发前必须确认「执行模式 = 默认权限」与「模型 = 旗舰」，与目标不符时**中止而不是替用户改**——这属于用户偏好，不该被脚本悄悄改动。
- **幂等**：派发前用 SQLite 查最近会话是否已有同文本，避免重复建同名任务（标题是客户端自动生成的，会撞车）。
- **失败口径**：任何一步失败都返回结构化结果（`stage` + `error`），不静默降级成“剪贴板交接”，避免用户以为发出去了实际没有。
- **已落地并真机验证**（2026-11-19 18:26）：模块 `src/teleagent-dispatch.js` + 测试 `test/teleagent-dispatch.test.mjs`（10 个契约用例，已加入 `npm test`）。对真实客户端跑通一次派发，**11.7 秒**完成，SQLite 回读得到会话 `ses_e0ca84e5bffeqDRrt6LJnFZk4y`：标题「Agent Deck派发链路自检」、`directory=E:\Project_test\jifang_data_analysis`、正文与注入文本逐字一致、assistant 2 秒后回复「收到」、`finish=stop`。
- **接线（2026-11-19）**：在 Obsidian 的**任务行右键菜单**加「派发到 TeleAgent（自动填写并发送）」，仅 Windows 且 TeleAgent 启用时出现。点击后走 `dispatchToTeleagent`：用 `resolveProjectForTask` 从任务上下文（`[[wikilink]]` / 标题前缀 / 笔记路径）解析项目名，**解析不到就拒绝并提示去设置里登记项目文件夹**——猜错项目会把任务派进别的代码库。解析成功后仍**保留剪贴板兜底**（照旧复制全文），再调用 UIA 派发，并按结果提示成功或失败阶段。
- **已知缺口**：PowerShell 侧的错误文案仍是中文（`Fail 'project' '找不到「运行环境」选择器'`），英文界面下会显示中文详情；阶段名（`stage`）已统一，下一步可做 stage → 本地化文案的映射。

### 9.2 真机跑通时踩到的三个坑

写脚本时按“查一次就判断存不存在”来写会连挂三次，这三条都是实测撞出来的：

1. **React 分批渲染**：输入框先出现，`运行环境`/`执行模式`/`选择模型` 工具条后出现。第一版在拿到输入框后立刻查标签，直接判“找不到选择器”。→ 每个关键控件都必须带超时重试（`Wait-Name`，250ms 间隔）。
2. **点中下拉项后浮层会自己关**：此时再调 `Collapse()` 会抛 “Operation is not valid due to the current state of the object”，异常冒到 Node 侧只剩一行英文，看不出是哪一步炸的。→ 展开/收起必须幂等（先读 `ExpandCollapseState` 再动作）。
3. **选择器自己的 `Name` 等于当前项目名**：按名字找项目条目时会先命中选择器本身，而它只支持 `ExpandCollapsePattern`，`Invoke` 会抛异常。→ 候选必须按 Y 坐标排除选择器自身（它和「运行环境」标签同一行），再按 `X > 600` 排除侧栏同名项。

## 10. 交付边界

- 本文只覆盖 Windows。macOS（`AXUIElement`）与 Linux（`AT-SPI`）是**另一套接口**，Electron 在两端都能暴露无障碍树，但实现与 selector 都要重写，**未实测不外推**。
- 未经用户明确同意，自动化脚本**不得**执行会改变用户会话状态的动作（发送消息、删除任务、授权确认）。
