# TeleAgent 开源生态调研（社区项目、内核接口与取舍）

> 状态：**调研记录，不是接入方案**。接入方案见 [`../specs/teleagent-adapter.zh-CN.md`](../specs/teleagent-adapter.zh-CN.md)，本文只补它没覆盖的维度：社区怎么接、内核长什么样、哪些能借鉴、哪些别碰。
> 核验时间 **2026-11-17**（star / 更新时间均为此日实时快照）。核验平台：Linux 本机（已装 TeleAgent 3.x），另 clone 了 33 个仓库读本地 README 与源码。**Windows / macOS 行为仅来自各仓库 README，未实机复核**，按 AGENTS.md 口径不外推。
> 所有结论都标了出处：`仓库 → 路径:行号`；只有 README 支撑的写「README 侧证」，代码里没看到的写「未在代码中确认」。

---

## 0. 结论先说

1. **电信 TeleAgent 本体闭源**，本次检索范围内 GitHub 上没有官方 app / SDK 仓库；可查的「官方开源资产」只有星辰大模型（`Tele-AI/Telechat`、`TeleChat2` 等）和一支疑似团队账号的 Skill 编译器；TeleAgent 本体没有官方仓库。
2. 社区生态分五层：**DSH 插件（3 个实现）→ OpenAI 兼容网关（至少 8 个）→ 账号/鉴权/保活配套（6+）→ MCP 与技能（30+）→ 客户端封装（CLI / Docker Web）**。全部是逆向或复用官方内核，**本次检索范围内未见官方授权/背书**。
3. **接入路线只有三条**，差别在「谁负责签名、登录态放哪」：① 驱动官方 Go 内核代签（`dsh-teleagent`、`anbulang/dsh-connect-teleagent`、`TXGZ0777`）；② 自己复刻 v1 两轮 HMAC 直连云网关（`alvinhuang`、`liao96312` 方案 A、`teleagent-auth`、`samiya782`）；③ 复用本机内核 HTTP API（`liao96312` 方案 B、`TeleAgentCLI`、`TeleAgentToAPI`）。
4. **对 Agent Deck 有用的只有「只读数据 + 启动器/深链探测」**：社区已把数据根、SQLite 结构、`preset-context.json`、`model-catalog.json`、深链 `teleai-cowork://` 摸清，可直接验证/补强现有 spec；**内核、签名、凭据、账号池、保活签到一律不碰**（与 spec §3.5 一致）。
5. 这个生态**极不稳定**：2026-11 云网关开始真验签，一批插件全量 `40104`；客户端 2.5.x → 3.0 又改了签名行为；已有真实封号案例（`40109`）。任何依赖它的自动化都只能是「研究」，不能是「基础设施」。

---

## 1. 名词澄清：三个「TeleAgent」

| # | 名字 | 判定依据 | 与电信的关系 |
|---|---|---|---|
| A | **TeleAgent / 星辰超级智能体**（中国电信 TeleAI） | 官网 <https://ta.teleai.com.cn/>、产品页 <https://www.teleai.com.cn/product/teleagent>；桌面/网页/移动端，桌面端装 `~/.local/share/TeleAgent`，内核 `super-agent-code`，上游 `agent.teleai.com.cn/superCowork/sapi` | **本体**，闭源商业 app。本机实测 3.x |
| B | **TeleAgent**（Telegram userbot / 终端桥） | `DeepPythonist/TeleAgent` 是 Telethon + OpenAI 的 Telegram 自聊机器人；`woguaiwo/TeleAgent` 是把 codex/kimi 包进 pty 再用 Telegram 遥控；`wty92911/teleagent` 是 Zellij 通知/跳转 | **同名无关**，名字里的 Tele 指 Telegram / teleport |
| C | 2016 年的 `TeleAgent/*`、`TeleAgentsTeam/*`、`TELEAGENTBOT2016/*` | 全是 2016 年的 Telegram bot 组织/仓库，代码与链接均与电信无关 | **同名无关**，历史存量 |

另一个容易混的官方名字：**「星辰超级智能体 TeleClaw 桌面版」**（官方新闻 4 月 30 日，页面未标年份）。它与 TeleAgent 的命名关系官方没解释，本文不把它当同一产品，只在来源里留档。

---

## 2. 生态全景表

> ★ / 更新时间为 2026-11-17 快照；「许可证」为空表示仓库内未见 LICENSE，不猜。

### 2.1 官方 / 疑似官方

> TeleAgent 客户端本体**无公开仓库**（官方只提供安装包下载，见 §10）；下表只列官方开源模型与疑似团队项目。

| 仓库 | ★ | 最近更新 | 许可证 | 一句话定位 |
|---|---:|---|---|---|
| `Tele-AI/Telechat` | 1.9k | 2026-07-09 | 未核实 | 中国电信 TeleAI 官方开源的星辰语义大模型（**不是 TeleAgent**） |
| `Tele-AI/TeleChat2` | 274 | 2026-07-09 | 未核实 | 星辰大模型二代，全国产算力训练 |
| `TeleAI-TeleAgent/ai-native-skill-compiler` | 5 | 2026-11-09 | 未见 | 把人类可读 Skill 编译成 AI 原生 Skill；README 自述「作者：TeleAgent ·《星辰超级智能体》团队」——**疑似团队，未证实官方** |
| `TeleAgent/TeleAgent`（org） | 3 | 2016-08-23 | 未见 | 2016 年 Telegram bot 组织，**无关** |

### 2.2 DSH 接入插件

| 仓库 | ★ | 最近更新 | 许可证 | 一句话定位 |
|---|---:|---|---|---|
| `KUMAKAIHA/dsh-teleagent` | 3 | 2026-10-16 | MIT | 拉起官方内核当代签层，只读工具 + 1M 上下文声明 + 面板内登录 |
| `anbulang/dsh-connect-teleagent` | 1 | 2026-11-11 | MIT | kernel 模式 + shim + MCP 工具桥，5 模型、积分、多账号、熔断 |
| `alvinhuang0509-design/dsh-connect-teleagent` | 0 | 2026-11-07 | MIT | 自己复刻 v1 两轮 HMAC，修 `40104`，带签到/积分账号条 |
| `836157055/dsh-teleagent-pool` | 0 | 2026-11-03 | MIT | 电信 + 智谱双号池面板；3.0 客户端下推理被签名挡住 |
| `caigou114/dsh-teleagent-skill-builder` | 0 | 2026-11-09 | MIT | 把 TeleAgent 技能制作规范做成 DSH 技能（校验/打包/安装） |
| `ylzqmjxh/dsh-pet-teleagent` | 0 | 2026-10-25 | MIT | 桌宠联动 TeleAgent 六态事件（thinking/working/…） |
| `anye-99/dsh-codearts-auth` | 23 | 2026-10-13 | 未核实 | 14 家 provider 的 DSH 登录/凭据插件，TeleAgent 只是其一（且回调需手贴） |

### 2.3 转 OpenAI 兼容 API / 网关

| 仓库 | ★ | 最近更新 | 许可证 | 一句话定位 |
|---|---:|---|---|---|
| `lizhun781021/teleagent-openai-proxy` | 23 | 2026-11-12 | MIT | 纯 Python 标准库代理 + Web 控制台 + launchd 守护，复用 4397 内核 |
| `ddddx/teleagent2api` | 7 | 2026-06-17 | 未见 | Go 直连云网关，Docker 友好，需手填 token/device/install |
| `liao96312/teleagent-proxy` | 6 | 2026-10-13 | MIT | 双方案（直连云网关 / App 本地 server）+ Go 版传输层保真 + 生图/视觉 |
| `hj01857655/TeleAgent2api` | 5 | 2026-10-29 | 未见 | OpenAI 兼容网关：请求白名单清洗、`<think>` 拆分、多账号故障切换 |
| `TXGZ0777/teleagent-proxy` | 3 | 2026-11-07 | MIT | Windows 本地反代：OpenAI/Responses/Anthropic 三协议 + 密钥台 + 提示词接管 |
| `samiya782/teleagent2api` | 0 | 2026-11-16 | 未见 | Go，读本机凭据（Linux/WSL/Windows DPAPI/浏览器 Cookie）+ token 自动续期 |
| `LiuChang1999/TeleAgentToAPI` | 0 | 2026-11-04 | MIT | Linux 服务器版：官方信创 deb 内核 + 多账号 + API Key 额度 + 管理后台 |
| `T786279007/teleagent2api-deploy` | 8 | 2026-07-05 | 未核实 | 上述 teleagent2api 的本地部署记录（OpenCode MCP 接入） |

### 2.4 鉴权 / 账号 / 保活 / 签到

| 仓库 | ★ | 最近更新 | 许可证 | 一句话定位 |
|---|---:|---|---|---|
| `Minatoxiaohu/agent-auto-signin` | 7 | 2026-11-04 | MIT | 五端每日积分脚本，TeleAgent 100 分/天，纯接口幂等 |
| `ihpdc/teleagent-baohuo` | 5 | 2026-11-14 | 未见 | 云电脑保活 + 一键开桌面 + 签到 + 电源管理 + 企微通知 |
| `xuexu/teleai-keepalive` | 2 | 2026-11-17 | 未见 | 复刻 CLINK 协议做协议级保活，多账号控制台 |
| `cuddlesgiggles/teleagent-auth` | 4 | 2026-10-18 | MIT | magpie provider：逆出签名门并实测通过，附封号边界 |
| `anbulang/opencode-teleagent-auth` | 2 | 2026-11-09 | MIT | magpie/OpenCode provider：现场两步 HMAC + 积分 + 多账号 + 熔断 |
| `baijiu666/magpie-TeleAgent` | 0 | 2026-11-13 | MIT | magpie provider：模型目录/续期/思考档位/图片，证据最细 |
| `goodtome/magpie-teleagent-login` | 0 | 2026-11-15 | MIT | magpie/OpenCode 登录插件，浏览器或手贴 token，不要求桌面端 |
| `mojed123/teleagent-cloud-helper` | 1 | 2026-11-14 | 未核实 | 浏览器插件：多账号一键进云电脑 + 青龙保活脚本 |
| `hututu001/teleagent-qinglong-keepalive` | 0 | 2026-11-14 | 未核实 | 青龙巡检：活动刷新、休眠唤醒、三次重试 |
| `LiuChang1999/TeleAgent-AccountsHub` | 1 | 2026-11-11 | 未核实 | 多账号切换助手 |
| `TimerDev/teleagent-dashboard` | 0 | 2026-11-17 | 未核实 | 与 `ihpdc/teleagent-baohuo` 描述相同，疑似同源/fork（未核实） |

### 2.5 MCP 与技能

| 仓库 | ★ | 最近更新 | 许可证 | 一句话定位 |
|---|---:|---|---|---|
| `T786279007/teleagent-mcp` | 10 | 2026-07-05 | 未见 | Claude Code 的 MCP 适配器，10 个工具，三层鉴权全自动抽取 |
| `T786279007/teleagent-chat-skill` | 1 | 2026-07-04 | 未核实 | 上述项目的 Claude Code Skill 封装 |
| `yuzhaopeng-up/teleagent-skills` | 2 | 2026-07-04 | Apache-2.0 | 5 个业务 Skill（评分/证据链/聚合/可视化/NL2SQL），4 阶段编排 |
| `unknowgiant/teleagent-mcp-server` | 0 | 2026-11-12 | 未见 | 通信行业 MCP：规范检索、基站 DXF 出图、方案成文、专线设计 |
| `Yenchih-coder/teleagent-zmx-webhook-…` | 2 | 2026-07-30 | 未见 | 量子密信群机器人 Webhook（文本/文件/图片），零依赖 |
| `Yenchih-coder/teleagent-quantum-messengerAI-` | 1 | 2026-07-30 | 未见 | 桌面自动化操作量子密信的 Skill（含视觉校验版） |
| `cctvgh/*`（23 个仓库） | 0 | 2026-11-04 | 未见 | 一批「TeleAgent skill: xxx」：A股、电力、QGIS、公文、Windows 优化等 |
| `david3832024-coder/teleagent-product-ppt-skill` | 2 | 2026-07-29 | 未核实 | 生成 TeleAgent 产品 PPT 的 Codex Skill |
| `danzhisuan/work_review_for_teleagent` | 2 | 2026-08-19 | 未核实 | 每日工作总结 / 电脑使用总结 Skill |
| `unknoen/teleagent-skills` | 0 | 2026-08-17 | 未核实 | 三门峡电信的定制 Skill |
| `sunny258-dmj/teleagent-shinchan-theme` | 0 | 2026-09-16 | 未核实 | 蜡笔小新 UI 主题 + Skill |
| `juventini10/Five-layer-memory-system` | 24 | 2026-10-27 | MIT | 多端五层记忆系统；TeleAgent 适配「规划中，未进包」 |

### 2.6 其它客户端封装

| 仓库 | ★ | 最近更新 | 许可证 | 一句话定位 |
|---|---:|---|---|---|
| `LiuChang1999/TeleAgentCLI` | 0 | 2026-11-10 | MIT | 无头 Linux CLI：官方内核 + 审批流 + deb 打包，包名 `teleagent-cli` |
| `mwh1987/fnos-teleagent` | 1 | 2026-11-17 | 未见 | 飞牛 fnOS FPK + Docker Web GUI（官方桌面端容器化） |
| `mwh1987/skills-teleagent-fork` | 0 | 2026-07-22 | 未核实 | `vercel-labs/skills` CLI 的 TeleAgent 分支 |
| `geekma/cloud-pc-bridge` | 1 | 2026-11-16 | MIT | 在 TeleAgent 云电脑内自建 HTTPS 控制面（不碰厂商客户端） |

### 2.7 同名无关

| 仓库 | ★ | 最近更新 | 许可证 | 真实用途 |
|---|---:|---|---|---|
| `DeepPythonist/TeleAgent` | 18 | 2025-12-30 | 未见 | Telegram Userbot（Telethon + OpenAI），人格扮演/自动接话 |
| `wty92911/teleagent` | 0 | 2026-03-30 | MIT | Zellij 跨端通知 + 终端瞬间跃迁（teleport），Rust |
| `woguaiwo/TeleAgent` | 0 | 2026-06-12 | MIT | 把 codex/kimi 包进 pty，经 Telegram 遥控与审批 |
| `gt-del/TeleAgent` | 1 | 2026-06-23 | 未核实 | GSM 网关 AI 外呼系统 |
| `MatheusLTrindade/Teleagent` | 2 | 2026-10-30 | 未核实 | 本地 AI agent 与 Telegram 的桥（葡萄牙语） |
| `dexccv/Telegram-Agent` | 2 | 2026-10-30 | 未核实 | 自称 TeleAgent 的终端 agent + Telegram 网关 |
| `TeleAgent/*`、`TeleAgentsTeam/*`、`TELEAGENTBOT2016/*` | 0–3 | 2016 | 未见 | 2016 年 Telegram bot 存量 |

---

## 3. 逐项目剖析

### 3.1 `KUMAKAIHA/dsh-teleagent`（DSH，内核代签路线）

**解决什么**：让 DSH 直接把 TeleAgent 的档位模型当 provider 用，同时避开最脏的一步——自己复刻云网关签名。

**功能清单**
- 5 个档位模型：`chat-flagship` / `chat-flash` / `chat-pro` / `chat-lite` / `chat-nano`（`README.md:19-27`）。
- 上下文可配置，读账号级 `preset-context.json`；面板提供 200K / 400K / 1M 快捷键（`README.md:24`、`:69`）。
- 工具调用：内核自带 agent 循环执行**只读**工具 `read / glob / grep / webfetch / websearch`，结果作为一段最终文本返回（`README.md:25`、`:122`）。
- 登录：DSH 设置页内嵌官方登录页（`source=01` 走 DESKTOP 流程），`postMessage` 回传 token；已装客户端则直接复用本地 token（`README.md:71-83`）。
- 请求节流 `requestIntervalMs` 默认 1200ms（`README.md:27`、`:95`）。
- 面板：运行状态 / 账号 / 凭证有效期 / 各档位上下文 / 最近错误（`README.md:61-69`）。
- 已明确**不支持**第三方 tools 定义（签名覆盖 body，注入必失败）（`README.md:121`）。

**实现方式**
- 入口 `index.js`；`src/engine.js` 管内核生命周期：默认 `port=4399`、`proxyPort=8795`（`src/engine.js:391`）；以最小 env spawn 内核，敏感状态用 stdin「4 字节大端长度 + JSON」注入，`SERVER_PORT` 指定端口，`GET /health` 就绪探针（`src/engine.js:556-567`）。
- `src/signproxy.js` 是「签名代理」：原设计想把调用方 body 换进已签名请求，**实测 `40104 invalid signature` 证明签名覆盖 body，该路径已标 INACTIVE**，现在只做内核流量的透明转发（`src/signproxy.js:1-19`）。
- 登录窗口走 Electron `session.fromPartition('persist:teleagent-login')`（`src/loginwindow.js:78`、`:243`）。
- 凭据：`~/.dsh/teleagent/token.txt`（0600）、`provider-key.txt`（0600）、`status.json`；登出写 marker 阻止回退到 app 存储并杀内核（`README.md:151-157`）。

**依赖/技术栈**：Node ESM，DSH 插件规范（`cordis.patch.yml` + `dsh.client`），peer 依赖 `@deepseek-ai/schemastery`；无需额外构建。

**可借鉴**：① 用「进程 + stdin 注入」而非环境变量传密钥（避免 `ps eww` 泄漏）；② 把「签名覆盖 body」这条硬约束写成已知边界，而不是硬试；③ 面板里暴露 token 来源与有效期，便于排障。
**风险**：内核监听 `0.0.0.0:<port>` 而非回环（作者实测局域网可访问 `/health`，其余端点 401），本机防火墙需自行处理（`README.md:143-145`）；不校验 JWT 签名（只 base64 解 exp）；私有协议随客户端升级失效。

**证据**：`dsh-teleagent → src/engine.js:391, :556-567；src/signproxy.js:1-19；src/loginwindow.js:78, :243；README.md:19-27, :71-83, :121-125, :143-149`。

### 3.2 `alvinhuang0509-design/dsh-connect-teleagent`（DSH，自签路线）

**解决什么**：2026-11 云原生网关开始真验签后，旧插件全部 `40104 unsupported sign version`，DSH 把它误报成「API 密钥无效」。这个项目把**正确的 v1 两轮 HMAC** 落进 DSH 插件。

**功能清单**
- 推理：OpenAI 兼容 SSE，支持 tools / system / max_tokens / temperature / stop（`README.md:185-193`）。
- 登录：复用 `~/.dsh/.credentials.yaml` 里 `dsh-codearts-auth` 写好的凭据；新机器手贴 token（浏览器自动登录已移除，因 `teleai-cowork://` 会被官方客户端抢走）（`README.md:90-98`、`:124-154`）。
- 积分/签到：余额 `data.current_points_balance`、每日可领、累计天数/积分、一键领取（GET `checkTask`）（`README.md:189`）。
- 输入框账号条：`● 16,034.51 · AlvinH`，含套餐、签到、活动标题、刷新时间；120s 轮询且仅可见时拉取（`README.md:104`）。
- 设置页：登录状态/有效期、打开官方登录页、粘贴回调、修复凭据、查余额/签到/领取、模型列表（`README.md:116`）。
- 斜杠命令（headless 可用）：`/teleagent status|login|repair|balance|checkin|claim|user`（`README.md:117-121`）。
- 上下文：声明式预算，默认 100K / 16384，面板可选 100K/200K/500K/1M，`perModel` 可单档覆盖（`README.md:156-181`）。
- 模型表：`chat-nano` 轻量 / `chat-lite` 智能 / `chat-pro` 旗舰，三档共享 100K（与其它仓库的 5 档/400K 说法不同，见 §5.4）（`lib/product.js:58-62`）。

**实现方式**
- 关键模块 `lib/sign.js` 直接算签名：`m1 = ["superagent-auth-v1", token, installId, tsSec, nonce].join("/")`；`bodyHash=sha256(exact bytes)`；`m2 = [...].join("\n")`；`sig2=hex(HMAC(K=sig1, m2))`（`lib/sign.js:16-21`、`:114-115`）。
- 端点常量集中在 `lib/product.js`：`API_BASE=https://agent.teleai.com.cn/superCowork/sapi`、`INFER_PATH=/api/v1/chat/completions`、签到 `.../v2/checkDayTask`、`.../checkTask`、`X-Route-Target: ops-gateway`（`lib/product.js:19-29`）。
- 登录态解析：官方登录 token 优先，其次应用存储；`installId` 首次生成后持久化（`README.md:90-100`）。
- 客户端半身 `lib/client.js` 预构建随包发布，无 `prepare` 脚本（避免 pnpm 构建失败）（`README.md:74-88`）。

**依赖/技术栈**：Node，DSH ≥0.1.2-rc.1（peer：`dsh-llm` / `dsh-credentials` / `dsh-commands` / `cordis`），npm 包 `dsh-connect-teleagent@1.2.6`。

**可借鉴**：① 把「错误码 → 人话」做对（`40104` 不是密钥错）；② 上下文做成「可声明预算」而不是假装服务端有上限；③ 提供 headless 斜杠命令，便于脚本化验证。
**风险**：**硬编码了客户端内置渠道 apiKey**（`lib/product.js:11`，本文不转载该值）——供应链上看，任何拿到该 key 的人都能打上游；作者自己也写了封号警告 `40105 → 40109`，且要求串行、固定 deviceId/installId（`README.md:213-223`）；`40104` 反复试探会加速风控。

**证据**：`dsh-connect-teleagent → lib/sign.js:16-21, :114-115；lib/product.js:11-29；README.md:40-54, :156-193, :213-223`。

### 3.3 `anbulang/dsh-connect-teleagent`（DSH，内核 + 工具桥路线）

**解决什么**：既不想伪造签名，又想让 DSH 的 tools 真正可用。做法是：默认让官方内核发请求，把 DSH 的工具挂成内核侧 MCP 工具，调用仍回 DSH 执行。

**功能清单**
- 5 模型（智能/旗舰/极速/轻量/轻速），400K 或 100K 上下文、65536/16384 输出、图片、积分倍率（`README.md:27-47`）。
- 真流式 SSE，`reasoning_content` 可在 DSH 折叠查看（`README.md:29`）。
- 工具桥（MCP）：DSH 工具透传给模型，调用由 DSH 执行，有卡片/权限（`README.md:30`）。
- 图片输入：`chat-pro` / `chat-flash`，走本机持久附件服务（`README.md:31`）。
- 积分：余额 + 每日自动领取（幂等），设置卡片与输入框胶囊（`README.md:32`）。
- 多账号：本机账号列表 + 「添加账号」；换号时先备份旧 `token.json`，登录后原样写回（`README.md:33`、`:168-204`）。
- 可订阅：自带 format-1 插件索引，DSH「发现」页一键添加（`README.md:34`）。
- 防突发：并发 2、连续 3 次 401/403 熔断 10 分钟、半开 1 个（`README.md:329-336`）。
- 诊断：`node lib/doctor.js`；`npm test` 覆盖模型/签名/生命周期/多账号/内核/图片预算（`README.md:337-347`）。
- 配置分层：4 个可热改设置（providerDisabled/enabledModelIds/toolsAllowlist/autoClaimDaily）+ 传输/内核参数在 `cordis.patch.yml`（`README.md:233-285`）。

**实现方式**
- 内核模式：DSH → 本地 OpenAI shim（127.0.0.1 随机端口）→ 官方内核（Go，`~/.dsh-teleagent-kernel`）→ 上游（`README.md:206-219`）。
- 内核无参数启动，敏感 env 走 stdin：4 字节大端长度 + JSON；但作者注释「实测本机内核只认 spawn 的 env，stdin 那份没被采纳」——与 DESIGN 的结论有出入（`lib/kernel.js:10-14`、`:513-532`）。
- 内核鉴权 `SUPER_AGENT_LOCAL_SESSION_KEY` + `SUPER_AGENT_AUTH_STATE`（AES-256-GCM 信封）（`lib/kernel.js:467-468`）。
- 发消息走 `POST /session/:id/prompt_async`（204）+ `GET /event` SSE 收流；`/event` 是全局流，必须按 sessionId 过滤（`lib/kernel.js:14`、`:915`）。
- MCP 桥：把 DSH 工具挂进内核 MCP，`denyBuiltinTools: true` 默认禁止内核自带工具（`README.md:273-277`）。
- guard 默认 `maxConcurrent:2 / failureThreshold:3 / cooldown 10min / 20 rpm`（`lib/guard.js:24-32`）。

**依赖/技术栈**：Node 22.19+/24，DSH ≥0.2.1-rc.1，`@earendil-works/pi-ai`，React 客户端面板；包版本 0.14.1（与 alvinhuang 同名，npm 上的 1.2.6 是另一实现，两者不可混装）。

**可借鉴**：① 用 shim 保持 OpenAI 兼容，把内核差异关在一个模块里；② `toolsAllowlist` 直接对着「省 token」这个真实痛点（实测 255 个工具 = 875KB schema ≈ 22 万 tokens，`README.md:306-327`）；③ 明确声明「不伪装官方客户端」并列出可识别差异（`README.md:357-368`）。
**风险**：内核会额外发 `security/instruction/review` 审核请求，成本翻倍（`README.md:300`）；多账号靠「备份 token → 换号 → 写回」，一旦中途崩溃有恢复逻辑但依赖桌面端关闭；直连回退模式仍要处理签名。

**证据**：`dsh-connect-teleagent (anbulang) → lib/kernel.js:10-14, :467-468, :513-532；lib/shim.js:136, :372；lib/guard.js:24-32；README.md:25-47, :206-231, :329-336`。

### 3.4 `liao96312/teleagent-proxy`（双方案 + 最全逆向笔记）

**解决什么**：把桌面端模型能力暴露成 `127.0.0.1:8788/v1`，同时给出「直连云网关」与「走 App 本地 server」两条路，并附封号风险文档。

**功能清单**
- OpenAI 兼容 `/v1/models`、`/v1/chat/completions`（`README.md:34-45`）。
- 方案 A：直连云网关，**支持调用方自定义 tools**；需自己算两轮 HMAC（`README.md:45-60`）。
- 方案 B：走 App 本地 server `127.0.0.1:4397`，出站流量与 App 一致，**不需要自己签名**，但 App 必须开着（`README.md:45-60`）。
- 内核工具：bash/PowerShell、读写文件、搜索、**生图**、联网搜索、MCP（playwright 默认挂载）（`README.md:331-351`）。
- 生图 `POST /v1/images/generations`（模型 `image-generation-pro`，尺寸 ≥1920×1920）、视觉 `image_url` 自动切 `vision-standard`（`README.md:110-114`）。
- pi 集成：支持「内核子代理」模式，把执行整体外包给内核 agent loop（`README.md:436-460`）。
- 恢复工具：`setup.cmd` / `get-session-key.py` / `start-shim-go.cmd` / 自检（`README.md:78-118`）。
- 风险文档：`docs/ban-risk.md`、`docs/signature-algorithms.md`、`docs/kernel-internals.md`、`docs/wire-fidelity.md`。

**实现方式**
- 方案 B 的核心：冒充 App 前端给 4397 发带 `X-SA-Signature` 的请求；`sessionKey` 由 Electron 主进程 `randomBytes(32)` 生成，经 stdin/env 传给内核，脚本从进程内存抓（`docs/kernel-internals.md:23-44`）。
- 本地签名：`HMAC-SHA256(sessionKey, ["local-v1", METHOD, pathWithQuery, ts(ms), 12B hex].join("\n"))` → base64url（`README.md:280-305`）。
- 内核接口（OpenCode 风格）：`/session`、`/session/:id/message`（**同步阻塞**，跑完整 agent loop 才返回）、`/session/:id/abort`、`/permission`、`/provider`、`/config`、`/global/event`（`README.md:305-323`）。
- 会话映射：用「历史消息前缀 SHA1」把多轮绑到同一内核会话（`README.md:280-300`）。
- 直连签名：`m1` 用 `/` 分隔，`m2` 用 `\n`，`bodyHash=sha256(body)`，`sig2` 作为 `X-Superagent-Signature`（`docs/signature-algorithms.md:33-39`）。

**依赖/技术栈**：Windows，Go 1.26（Go 版 shim，传输层指纹对齐）+ Node（Node 版）+ Python stdlib（取 key）；MIT。

**可借鉴**：① 两方案对比表把「出站流量特征 / 是否需要 App 开着 / 封号风险」讲透，是决策模板；② `kernel-internals.md` 把进程树、端口、三层鉴权、注入 env 列全，是本主题最好的单一文档；③ 会话映射用历史前缀哈希，避免依赖客户端 session id。
**风险**：明确写了「已有账号因本方法被封（`40109`）」；Go 版要求与内核同版本 Go，升级即碎；方案 B 需读进程内存，属于高侵入。

**证据**：`teleagent-proxy (liao96312) → README.md:34-60, :78-118, :280-323, :331-351, :436-460；docs/kernel-internals.md:6-44；docs/signature-algorithms.md:33-39`。

### 3.5 `TXGZ0777/teleagent-proxy`（三协议 + 密钥台 + 提示词接管）

**解决什么**：Windows 上把已登录桌面端反代成 `127.0.0.1:8787/v1`，并解决「Codex CLI 只认 Responses、Claude Code 只认 Anthropic」的协议差。

**功能清单**
- 三协议：`/v1/chat/completions`（OpenAI）、`/v1/responses`（Codex）、`/v1/messages`（Anthropic），另有 `count_tokens`（`README.md:221-244`）。
- 工具中继：Codex 的 `tools` 挂成内核侧 MCP（`ta_shell` 等），调用挂起 → 翻成 `function_call` 交回 Codex → 下轮用 `function_call_output` 放行（`README.md:146-169`）。
- Web 管理台：密钥生成/改名/有效期/批量启停/重置、14 天趋势、200 条流水、鉴权模式 auto/on/off（`README.md:245-266`）。
- 提示词接管：内置人设硬编码在内核；`agent.build.prompt` 可由网关替换；空串会回落官方人设，已修为「始终显式设置」（`README.md:268-341`）。
- 抓包/自检：`npm run capture`、`tools/probe-prompt.mjs`、`GET /healthz` 回读 `agent.build.prompt` 校验（`README.md:320-341`）。
- 反代实现：DPAPI 解 `Local State` → AES-256-GCM 解 `v10` token；内核 stdin env；`X-SA-*` 本地签名（`README.md:359-386`）。
- 限制：角色被折叠成文本、只有 Responses 工具中继完整、并行工具未验证、每轮固定 1.0–1.2 万 input tokens（`README.md:387-400`）。

**实现方式**
- 入口 `server.mjs`；`lib/auth.mjs`（v10/DPAPI/JWT）、`lib/kernel.mjs`（stdin payload/env/X-SA 签名）、`lib/events.mjs`（`/event` SSE 累积转增量）、`lib/shim.mjs`、`lib/responses.mjs`、`lib/toolbridge.mjs`、`lib/mcp-server.mjs`、`lib/anthropic.mjs`、`lib/keystore.mjs`、`lib/admin.mjs`（`README.md:415-440`）。
- 本地签名 `["local-v1", METHOD, path, ts, nonce].join("\n")`（`lib/kernel.mjs:78-81`）；env 走 stdin（`lib/kernel.mjs:263-271`）。
- 关键坑都写在 README：spawn 管道 stdio 在沙箱会 EPERM → payload 落临时文件用 fd；`temperature: true` 会让上游 400；内核会把自己收到的 prompt 当 part 发回，必须按 sessionID + role=assistant 过滤；失败要 `POST /session/:id/abort`（`README.md:374-386`）。

**依赖/技术栈**：Node，仅 Windows 实机验证；MIT；版本 0.3.2。

**可借鉴**：① 「提示词三层」的拆解（内核人设 / agent prompt / 环境块）是理解所有内核类项目的钥匙；② 密钥台 + 用量统计是自用网关的标配；③ 把「内核会偷偷执行工具」写成安全坑，并用 `permission: deny` + 工具开关压住（`README.md:384`）。
**风险**：管理台仅回环但无 TLS；密钥表明文 JSON；仍依赖 DPAPI 与客户端版本；作者明确「自用，不要对外」。

**证据**：`teleagent-proxy (TXGZ0777) → README.md:146-169, :211-266, :268-341, :359-400；lib/kernel.mjs:78-81, :263-271；lib/auth.mjs:1-6；lib/responses.mjs:4-5`。

### 3.6 `lizhun781021/teleagent-openai-proxy`（Python 零依赖 + 控制台）

**解决什么**：macOS 上把桌面端 super-agent 转成 OpenAI 接口，给 LangChain/Cursor/ChatBox 等直接接。

**功能清单**
- `/v1/chat/completions` + `/v1/models`，流式/非流式、多轮（README §特性）。
- 自动从运行中的 scheduler 进程取 `SUPER_AGENT_LOCAL_SESSION_KEY` 并签名（README §签名机制）。
- 模型管理：只展示已配置成功的 provider/model，每 30 秒同步；默认模型可切换（README §Web 控制台）。
- Web 控制台：仪表盘、模型管理、默认模型、请求日志（200 条）、在线测试、会话管理、系统信息、使用说明（README §Web 控制台）。
- 持久化：macOS launchd 开机自启 + 崩溃重启（README §持久化运行）。
- 零依赖：纯 Python 标准库，无需 pip（README §技术细节）。

**实现方式**：单文件 `openai_proxy.py`（纯 stdlib `http.server`/`hmac`/`json`/`threading`）；每请求独立线程；创建 super-agent 会话 → `POST /session/{id}/prompt_async` → 监听 `/global/event` SSE → 转 OpenAI；签名 `HMAC-SHA256(sessionKey, ["local-v1", method, path_with_query, ts_ms, nonce])` base64url（README §工作原理、§签名机制）。

**依赖/技术栈**：Python 3.8+，macOS，TCC 权限（launchd 需已授权解释器）；MIT。

**可借鉴**：① 「零依赖单文件」把部署门槛降到最低；② 控制台里的「在线测试」对排障很实用；③ launchd 模板可直接抄。
**风险**：只 macOS；强依赖 App 运行（取进程 session key）；README 没有封号风险章节（与 liao/TXGZ 相比缺一块）。

**证据**：`teleagent-openai-proxy → README.md §特性/§工作原理/§签名机制/§Web 控制台`（仓库未 clone，行号未取）。

### 3.7 `teleagent2api` 三家（Go 直连 / Go 本机凭据 / 多账号网关）

| 项目 | 路线 | 关键差异 |
|---|---|---|
| `ddddx/teleagent2api` ★7 | 直连云网关（Go） | 手填 `TELEAGENT_TOKEN / INSTALL_ID / DEVICE_ID`；Docker；内置 API Key 鉴权；`TELEAGENT_BASE_URL` 可换；重试次数可配（README §配置）。适合「已有 token、想容器化」 |
| `samiya782/teleagent2api` ★0 | 读本机凭据（Go） | 零配置读 Linux `local-key` / Windows DPAPI `v10` / 浏览器 Cookie（`operationToken`/`x-token`）；token 自动续期（`POST /cowork/auth/token-refresh`，每 6h 检查 `renewal-schedule.json`）；只监听回环（`main.go:90`、`:105`；`refresh.go:16`；`credentials.go:742`） |
| `hj01857655/TeleAgent2api` ★5 | 多账号网关 | 请求白名单清洗、`<think>` 推理拆分、多账号故障切换（README 描述） |

**共同功能**：OpenAI `/v1/models` + `/v1/chat/completions`、SSE、`reasoning_content`、`tool_calls`（samiya 的 `main.go:126`、`:255-258`）；模型目录 `GET /superCowork/sapi/api/v1/model-options?language=zh-CN`。
**实现方式**：Go 单二进制；samiya 的凭据搜索顺序是 `app-auth/device-meta.json` → `users/*/app-auth/token.json` → `local-key`（Linux）或 `Local State`（Windows），再回退 Chrome/Edge Cookie（README §当前状态）。
**可借鉴**：samiya 的「续期遵守官方节奏、当天官方已续期就不再请求」是最稳的做法（README §令牌续期）；ddddx 的 12-factor 配置表最完整。
**风险**：ddddx/samiya 未见 LICENSE；samiya `stream:false` 仍透传 SSE 不聚合（README §当前状态）；三家都要本机登录态，换机即失效。

**证据**：`teleagent2api (samiya) → main.go:29, :90, :105, :124；refresh.go:16；credentials.go:742；teleagent2api (ddddx) → README.md §配置`。

### 3.8 `LiuChang1999/TeleAgentCLI`（把「teleagent-cli」这个名字坐实）

**解决什么**：在**无头 Linux 服务器**上用 TeleAgent，复用官方 Linux 内核，不逆向签名。

**功能清单**
- 登录：手机号验证码（浏览器回调 / 手贴 / 已有 code）、网页表单粘贴（`--manual-http`）、从 Windows 导入 `credential.json`（README §快速开始）。
- 交互：`-C` 工作目录、`-m` 模型、`-p` 一次性、`--json`、`models`/`sessions`/`auth status`/`daemon status|logs`（README §常用命令）。
- 会话内命令：`/model`、`/new`、`/resume`、`/dir`、`/rules`、`/yolo on|off`、`/cost`、`/audit`、`/status`（README §常用命令）。
- 审批流：`edit/bash/webfetch/external_directory` 逐条询问，`y/s/a/n/d` 映射内核 `once/session/always/reject`；`--yolo` 自动放行并写 `.teleagent/audit.jsonl`（README §审批）。
- 打包：`scripts/build-deb.sh` 产出 `teleagent-cli_0.1.0_amd64.deb`，内含 Node 24、官方内核、CLI、`provider.json`（README §deb 打包）。
- 安全：状态文件 0600、内核只监听 127.0.0.1、token 不写日志（README §安全）。

**实现方式**：`bin/teleagent.js` + `src/{cli,kernel,daemon,auth,repl,audit}.js`；内核端口从 18100 起找空闲（`src/daemon.js:61`）；`src/kernel.js` 用 HMAC `local-v1` 请求头访问内核的 `/session`、`/session/:id/message`（`src/kernel.js:17`、`:93-126`）。
**依赖/技术栈**：Node ≥20；MIT；`package.json:2` 的包名就是 **`teleagent-cli`**（**未发布到 npm**，见 §4）。
**可借鉴**：审批交互 + 审计日志是「把 agent 放服务器」的最小可用形态；deb 打包把 Node/内核/配置一起固化，避免环境漂移。
**风险**：README 明确「内核是官方二进制，升级后路由/协议可能变化」；单内核串行；`provider.json` 含客户端内置 key，分发前必须替换（README §deb 打包）。

**证据**：`TeleAgentCLI → package.json:2；src/daemon.js:61；src/kernel.js:17, :93-126；scripts/build-deb.sh:19；README.md §快速开始/§审批/§deb 打包`。

### 3.9 `mwh1987/fnos-teleagent`（Docker Web GUI，官方客户端容器化）

**解决什么**：把官方桌面端塞进容器，在飞牛 fnOS / 群晖 / QNAP / 任意 Linux 上以 Web GUI 用，解决「没有 Windows/Mac 桌面」的部署问题。

**功能清单**
- FPK 在线安装包（~112KB），安装时拉多架构镜像 amd64/arm64（README §特性）。
- 端口向导（默认 5800）+ 冲突自检；改端口后桌面图标自动同步（README §特性）。
- 容器内预装 Chrome Stable，注入 `PLAYWRIGHT_CHROME_EXECUTABLE_PATH` 等，供 agent 的浏览器自动化用（README §特性）。
- tint2 任务栏 + 窗口最小化还原；Fcitx 中英切换按钮 + 托盘图标（README §特性）。
- 开发工具链 git/gcc/make/vim + 免密 sudo；Python 3.12 预装 openpyxl/python-docx/python-pptx/pandas（README §特性）。
- 阿里云 apt/pip 源、中文字体别名（SimSun/SimHei/微软雅黑）；GPU VA-API 自适应；NAS `@appshare/teleagent/workspace` 直通（README §特性）。
- 登录方式：容器内打开 TeleAgent 页面扫码登录（README §安装使用步骤）。

**实现方式**：`FROM jlesage/baseimage-gui:debian-12-v4`（`Dockerfile:1`），Xvfb/Openbox 的 GUI 基座；`startapp.sh` 起官方 Linux 客户端；`fpk/` 是飞牛打包工程（manifest/wizard/cmd/app）。
**依赖/技术栈**：Docker、Debian 12、TeleAgent Linux 客户端（信创版）；未见 LICENSE。
**可借鉴**：`@appshare` 工作区直通与中文字体/输入法处理，是「把 Electron agent 放进 NAS」的完整清单。
**风险**：等于在服务器上跑官方客户端，账号/数据落到 NAS；官方 ToS 未授权容器化；镜像由个人维护（Docker Hub `mwh1987/teleagent-web`），供应链需自审。

**证据**：`fnos-teleagent → Dockerfile:1；README.md:1-110`。

### 3.10 `cuddlesgiggles/teleagent-auth` 与 `anbulang/opencode-teleagent-auth`（magpie 供应商）

**解决什么**：把 TeleAgent 接进 magpie（OpenCode 系）的 provider 体系，复用桌面端登录态、不要 API key。

**功能清单（cuddlesgiggles）**
- 两种登录：桌面端登录态（默认，解本机 token）/ 手贴 `X-Token`（没装客户端时）（`README.md:10-21`）。
- 模型目录 + 积分明细 + 对话三条路径；积分按来源拆窗口，给出「最早作废那笔」（`README.md:54-66`）。
- 对话逐请求签名；签名方案从主程序 `GatewaySigner.Sign` 反汇编读出（`README.md:68-97`）。
- 明确不做的两件事：续期（没有可复用接口）、价格倍率（不发明）（`README.md:99-106`）。

**功能清单（anbulang/opencode-teleagent-auth）**
- 5 模型，400K/100K，图片输入，积分倍率（`README.md:24-50`）。
- 无 API key 登录：macOS 钥匙串 / Windows DPAPI / Linux local-key（`README.md:52-78`）。
- 每请求现读 token、现签两步 HMAC、带设备指纹（`README.md:229-274`）。
- 真流式、多轮、工具调用、`reasoning_content`（`README.md:284-298`）。
- 积分/签到 + 只读工具 `points`；多账号；并发 2 / 20 rpm / 熔断（`README.md:160-190`、`:335-347`）。

**实现方式**：
- cuddlesgiggles：`index.mjs`（插件入口）+ `safestore.mjs`（v10/DPAPI 解密）+ `teleagent.mjs`（provider 与签名）+ `test/teleagent.test.mjs`；`X-Token` + `X-Superagent-*` 头；`Authorization: Bearer <内置 relay key>` 只是「像官方客户端」的特征（`README.md:22-32`、`:68-97`）。
- anbulang：magpie 的 `openai-compatible` provider + 自定义 `auth.loader` 返回的 fetch；`lib/sign.mjs` 两步 HMAC；`lib/portal.mjs` 积分/签到；`lib/guard.mjs` 熔断（`README.md:214-298`）。

**可借鉴**：① cuddlesgiggles 的「探测边界表」（只带网关头→40101；只带 superagent→40301；两组+乱签名→40104）是排查签名的标准路径；② anbulang 的「签到先查 `claimed_today`、领完再查一次」是幂等范式；③ 两家都强调「不要批量测模型」。
**风险**：**封号复盘**（anbulang 仓库 `README` 与 `docs/PROTOCOL.md`）：2026-10-27 两个账号因合成探测被封，第二个约 1h45m 后封；封的是模型通道（`40109`），积分接口仍正常——「积分还能查」不能证明账号没事（`opencode-teleagent-auth → README.md:311-334`）。另外，relay key 内置、token 每次现读，若桌面端同时刷新会被顶下线（magpie 文档也提到）。

**证据**：`teleagent-auth → README.md:10-32, :54-106；opencode-teleagent-auth → README.md:24-50, :214-298, :311-347`。

### 3.11 `magpie-TeleAgent`（把「官方暴露什么」测到极限）

**解决什么**：magpie 的 TeleAgent provider，重点在模型目录、思考档位、续期、图片四件事的实测结论。

**功能清单**
- 两种登录：浏览器 CDP 读 `operationToken` / 从本机桌面端导入（Win/mac/Linux，safeStorage/keychain/libsecret/local-key）（`README.md:11-25`、`:99-135`）。
- `superagent-auth-v1` 请求签名；业务端点只认 `X-Token`（`README.md:11-25`）。
- 自动续期：按 token TTL 一半（上限 24h、最少 1min）调 `POST /cowork/auth/token-refresh`；优先采纳桌面端已续期的同账号新 token（`README.md:77-98`）。
- 动态模型目录：`/api/v1/model-options`，失败回缓存→兜底表（`README.md:40-49`）。
- 上下文跟随桌面端：读 `preset-context.json`，200K/400K/600K/800K/1M，默认 400K（`README.md:40-49`）。
- 请求清洗：上游只认少量字段；`max_tokens` 封顶；`reasoning_effort` 只认 `low/high/max`（`README.md:51-75`）。
- 图片实测：`chat-lite` 会 200 但答非所问，`chat-nano` 报非多模态，`chat-flagship` 报 1210（`README.md:86-98`）。

**关键结论**：服务端只暴露 `chat-pro`/`chat-flagship`/`chat-flash` 三个别名；`/v1/models` 全 404；网关接受任意 model 字符串（`does-not-exist` 也 200），所以「跑通」不能证明真实模型存在；曾自报 Z.ai/GLM，但版本不可定（`README.md:27-49`）。这直接解释了为什么各家模型表不一致（见 §5.4）。

**可借鉴**：把「能测到的」与「测不到的」分开写；思考档位用 `reasoning_effort: low` 把 reasoning tokens 降到 0（实测 35.9s→3.5s），是成本控制的实用开关（`README.md:51-75`）。
**风险**：magpie 与桌面端共享同一份 token，续期轮换可能互相顶下线；模型别名随时可能变。

**证据**：`magpie-TeleAgent → README.md:11-25, :27-49, :51-98, :99-135`。

### 3.12 账号配套：签到 / 保活 / 号池

| 项目 | 做什么 | 关键实现 |
|---|---|---|
| `Minatoxiaohu/agent-auto-signin` | 五端每日积分（TeleAgent 100 分/天） | 读 `app-auth/token.json`（macOS keychain / Windows DPAPI / Linux `peanuts`），失败回退 leveldb 用 `strings` 抓候选 token 逐个试探；签到幂等以「重查 `claimed_today` 翻转」为唯一成功判据（`README.md:6-30`、`:79-124`） |
| `ihpdc/teleagent-baohuo` | 云电脑保活 + 开桌面 + 签到 + 电源管理 | 每 5 分钟 `instance/connect` 换票 + 官方 `refresh/heartbeat`；关机/排队自动 `instance/start`；`instance/restart/rebuild`；企微 webhook；面板登录（`README.md:5-15`、`:67-85`） |
| `xuexu/teleai-keepalive` | 协议级保活（CLINK 三通道） | 复刻官方 Web 客户端：`instance/connect` → ctyun mTLS → CLINK MAIN/DISPLAY/INPUTS → 5s/30s 心跳 + PING/PONG + 假鼠标；被踢等 30 分钟（`README.md:5-30`） |
| `836157055/dsh-teleagent-pool` | 电信 + 智谱双号池 | TeleAgent 签到每天 09:00 + 10 分钟巡检 + 启动补签；**3.0.0 起推理被签名挡住**，只保留积分/签到（`README.md:10-30`、`:46-90`） |
| `LiuChang1999/TeleAgent-AccountsHub` | 多账号切换 | 仅 README 描述，未读源码 |
| `mojed123/teleagent-cloud-helper` | 浏览器插件 + 青龙 | 多账号一键进云电脑；未读源码 |

**共性**：全部依赖 `operationToken`（web）或桌面 token；都绕不开「官方客户端会把 token 轮换掉」；都只对自己账号用。**对 Agent Deck 全部禁止**——它们改服务器状态（签到/重启），且需要凭据。

**证据**：`agent-auto-signin → README.md:6-30, :79-124；teleagent-baohuo → README.md:5-15, :67-85；teleai-keepalive → README.md:5-30；dsh-teleagent-pool → README.md:10-30, :46-90`。

### 3.13 MCP 与技能生态

**`T786279007/teleagent-mcp`（Claude Code MCP）**
- 10 个工具：`teleagent_acp_start/stop/status`、`session_create`、`chat`、`models`、`providers`、`version`、`help`、`config_status`（`server.mjs:47-136`）。
- 三层鉴权自动抽取：Basic（`OPENCODE_SERVER_USERNAME/PASSWORD`）、HMAC `local-v1`（`SUPER_AGENT_LOCAL_SESSION_KEY`）、SuperAgent（内核内部）（README §Three-Layer Authentication）。
- 从 `ps eww <pid>` 抓环境变量（`server.mjs:236`、`:255`）；连桌面 `serve` 的 4397（`server.mjs:29`）。
- 可借鉴：把「桌面 serve 必须在跑」作为显式前置，失败信息给到 `pgrep -f 'TeleAgent serve'`；风险：读进程环境 = 高侵入，且 macOS 需权限。

**`TeleAI-TeleAgent/ai-native-skill-compiler`**
- 把标准 `SKILL.md` 编译成 AI 原生伪代码（GOAL/SAFETY/POLICY/RULES/FLOW/TOOLS 等 11 类对象），标准进/标准出，不换 runtime（README §一/§二/§3.2）。
- LLM 三阶段 + 三层验证（Guard/L1/L2）+ 编译价值判断器（负收益不编译）（README §3.3-§3.5）。
- 这是唯一一个「研究 TeleAgent 技能格式本身」的项目；README 自述团队身份，**未证实官方**。

**技能仓库群**
- `yuzhaopeng-up/teleagent-skills`：5 个业务 Skill（评分/证据链/数据聚合/可视化/NL2SQL），4 阶段编排 + YAML 参数化 + 降级，Apache-2.0（README §Skills Overview）。
- `caigou114/dsh-teleagent-skill-builder`：把平台技能规范做成 DSH 技能，带 `scaffold/validate/pack/install` 四个脚本；强制禁 `.pyc`（平台审核会整包拒收）（README §它做什么/§为什么必须禁止 .pyc）。
- `unknowgiant/teleagent-mcp-server`：通信行业 MCP（规范检索/基站 DXF/方案成文/专线设计），6 工具，部署进 TeleAgent 的 MCP 配置（README §工具清单/§部署到 TeleAgent）。
- `Yenchih-coder/teleagent-zmx-webhook`：量子密信群机器人 Webhook，纯 HTTP，零依赖（README §Features）。
- `cctvgh/*` 23 个仓库：批量「TeleAgent skill: xxx」，覆盖 A 股、电力、QGIS、公文、Windows 优化等；全部 0 star、无 LICENSE，属个人技能库。

**对 Agent Deck 的意义**：技能生态说明 TeleAgent 的扩展点是 `skills/` 目录 + MCP 配置，但**与只读追踪无关**；若未来要做「技能可见性」，只读 `skills/` 目录即可，不需要调内核。

### 3.14 同名无关项目（必须分清的四个）

| 项目 | 它到底是什么 | 判定依据 |
|---|---|---|
| `wty92911/teleagent` | CLI Agent 的跨端通知 + Zellij Pane 跳转（teleport） | Rust workspace：`tele-proto/tele-server/tele-client/tele-cli/tele-focus`；`tele-cli send --title ...`；Zellij env 自动捕获（README §架构/§组件/§CLI 用法） |
| `DeepPythonist/TeleAgent` | Telegram Userbot（Telethon + OpenAI） | `!ask` 命令、Ghost Mode、人格扮演；`requirements.txt` 含 telethon（README §Features） |
| `woguaiwo/TeleAgent` | 把 codex/kimi 包进 pty，经 Telegram 遥控审批 | `teleagent -- codex`；`~/.config/teleagent/teleagent.toml`；Telegram bridge（README §Quick start/§Telegram bridge） |
| `gt-del/TeleAgent` | GSM 网关 AI 外呼系统 | 自动拨号、实时语音对话、通话结果管理（仓库描述） |

**共同点**：名字里的「Tele」= Telegram / teleport / telecom 外呼，与「星辰超级智能体」无代码、无账号、无协议关联。**不要把它们的功能写进 TeleAgent 能力表**。

---

## 4. 特别核实：`teleagent-cli` 是否存在？

| 渠道 | 结果 | 说明 |
|---|---|---|
| npm `teleagent-cli` | **404** | 未发布 |
| npm `teleagent` | **404** | 不存在 |
| npm `dsh-teleagent` | ✅ 1.0.0 | 描述与 `KUMAKAIHA/dsh-teleagent` 一致 |
| npm `dsh-connect-teleagent` | ✅ 1.2.6 | 作者 `alvinhuang0509-design`（与 anbulang 同名包不同实现） |
| PyPI `teleagent` | ✅ 0.2.5 | 依赖 `telethon`，是 Telegram 机器人包，**与电信无关** |
| PyPI `teleagent-cli` | **404** | 不存在 |
| GitHub 精确名 `teleagent-cli` | **无** | 搜索只有 `LiuChang1999/TeleAgentCLI` 与 `mwh1987/skills-teleagent-fork` |

**结论**：`teleagent-cli` **不是已发布的产品名**，但它是真实存在的**包名**——`LiuChang1999/TeleAgentCLI` 的 `package.json:2` 写的就是 `"name": "teleagent-cli"`，deb 包也叫 `teleagent-cli_0.1.0_amd64.deb`（`scripts/build-deb.sh:19`）。**最接近的真实项目**：
1. `LiuChang1999/TeleAgentCLI`（★0，2026-11-10）——无头 Linux CLI，官方内核，审批流；
2. `wty92911/teleagent` 里的 `tele-cli`（同名不同物，见 §3.14）；
3. npm `workctrl`（描述含 "Teleagent local runner daemon"，但 README 是 `@teleagent/runner`、界面含泰文，**未证实与电信 TeleAgent 相关**，不计入生态）。

---

## 5. 横向解剖：TeleAgent 本地内核的技术画像

> 以下全部是**社区逆向 + 本机实测**，不是官方文档。官方只公开产品功能，不公开 API。

### 5.1 进程与端口

```
TeleAgent.exe (Electron 主进程)
├─ renderer
├─ node resources/scheduler/index.cjs daemon        # 调度/执行器
├─ node .../im-service/index.cjs                    # IM 桥
└─ runtimes/super-agent-code/bin/TeleAgent          # Go 内核， listen 127.0.0.1:4397
```
（`teleagent-proxy (liao96312) → docs/kernel-internals.md:6-21`）

- 桌面端本地 server 默认 **4397**（另有 19876）；内核自己也可被单独拉起，端口由 `SERVER_PORT` 决定：`dsh-teleagent` 默认 4399（`src/engine.js:391`、`:556`），`anbulang` 默认 47823（`README.md:284`），`TeleAgentCLI` 从 18100 起找空闲（`src/daemon.js:61`）。
- 就绪探针统一是 `GET /health` 或 `/global/health`（`dsh-teleagent → src/engine.js:442`；`anbulang → lib/kernel.js:628`）。

### 5.2 三层鉴权

| 层 | 头/机制 | 密钥来源 | 谁验 |
|---|---|---|---|
| ① 本地内核 | `X-SA-Signature: base64url(HMAC-SHA256(sessionKey, ["local-v1", METHOD, path, ts, nonce].join("\n")))` | Electron 启动时 `randomBytes(32)`；经 stdin/env 注入内核 | 内核 |
| ①' 本地备选 | `Authorization: Basic base64(OPENCODE_SERVER_USERNAME:PASSWORD)` | 同一批 env | 内核 |
| ② 云网关 | `X-Superagent-Signature`（两轮 HMAC） | JWT 第三段 + `installId` + `appVersion` + body | 云网关 |
| ②' 业务端点 | 只 `X-Token` | 桌面 token | 业务服务 |

- 本地签名注意：`ts` 有 **毫秒**（liao/`get-session-key.py`）与 **秒**（dsh-teleagent/liao 文档）两种说法，**以具体项目实测为准**；`X-SA-*` 与 `X-Superagent-*` 是两套头，不能混发（`opencode-teleagent-auth → README.md:253-274`）。
- 云签名：`m1` 用 `/` 连接，`m2` 用 `\n` 连接；`ts` 秒；`bodyHash` 必须对**实际发送的字节**做 SHA256；`signPath` 要含 `/superCowork/sapi` 前缀（`dsh-connect-teleagent (alvinhuang) → lib/sign.js:16-21, :114-115`）。
- 网关还要求 `X-App-Version` / `X-Os-Type`，缺了会 `40105 疑似攻击`（`teleagent-auth → README.md:54-66`）。

### 5.3 登录态与身份

| 项 | 位置/格式 | 证据 |
|---|---|---|
| 桌面 token | `~/.local/share/TeleAgent/users/<scope>/app-auth/token.json`，`{version, encryptedToken, scheme:"safe_storage"}` | `opencode-teleagent-auth → README.md:214-228` |
| macOS 解密 | keychain `TeleAgent Safe Storage` → PBKDF2-SHA1(pw,"saltysalt",1003,16) → AES-128-CBC，IV=16 空格，跳过 `v10` 前 3 字节 | `anbulang → docs/DESIGN.md:30-46` |
| Windows 解密 | `Local State` → `os_crypt.encrypted_key` → DPAPI → AES-256-GCM（`v10`+12B nonce+密文+16B tag） | `teleagent-proxy (TXGZ0777) → lib/auth.mjs:1-6` |
| Linux | `app-auth/local-key`（部分版本）；旧版 `v11` 固定口令 `peanuts` | `samiya → README.md:92-110`；`agent-auto-signin → README.md:79-124` |
| 身份字段 | `deviceId`（12 位 hex）、`installId`（UUID）、`appVersion`、`osType` | `alvinhuang → README.md:96-100`；`teleagent-auth → README.md:34-52` |
| 有效期 | JWT `exp` 约 30 天；续期 `POST /cowork/auth/token-refresh`，每本地日最多一次 | `samiya → README.md:40-58`；`magpie-TeleAgent → README.md:77-98` |

**Windows 路径有冲突**：`ddddx/teleagent2api` README 说 token 在 `%APPDATA%\TeleAgent\app-auth\state.json`；但 `cuddlesgiggles`、`anbulang` 以及 spec 引用的官方安装文档都说 Windows 也用 `%USERPROFILE%\.local\share\TeleAgent`。**以本机实测为准，ddddx 的说法未证实**（它可能指旧版或另一个安装形态）。

### 5.4 模型档位与上下文（各家说法不一致，原因是客户端版本）

| 来源 | 模型数 | 上下文 | 输出 |
|---|---|---|---|
| `anbulang` / `magpie` / `TXGZ0777` | 5（pro/flagship/flash/lite/nano） | 400K / 100K | 65536 / 16384 |
| `alvinhuang` | 3（nano/lite/pro） | 100K（三档共享） | 16384 |
| `dsh-teleagent` | 5 档位 | 读 `preset-context.json`，可 200K/400K/1M | 档位默认 |
| `magpie-TeleAgent` | 服务端只给 3 个别名 | 读 `preset-context.json`，200K–1M | — |

**结论**：服务端只稳定暴露 `chat-pro`/`chat-flagship`/`chat-flash` 三个别名（`magpie-TeleAgent → README.md:27-49`）；`chat-lite`/`chat-nano` 是客户端种子/旧版残留，是否可见取决于账号与版本。**文档里不要写死「5 个模型 / 400K」**。

### 5.5 流式与事件

- 内核是 OpenCode 风格 HTTP：`POST /session` → `POST /session/:id/message`（同步阻塞，跑完整 agent loop）或 `prompt_async`（202 + `/event` SSE）（`liao96312 → README.md:305-323`；`anbulang → lib/kernel.js:14`）。
- `/event` 是**全局流**，多会话会混在一起，必须按 sessionID 过滤；`message.part.updated` 的 `part.text` 是**累积全文**，要自己做增量（`TXGZ0777 → README.md:374-386`；`teleagent-mcp → README.md §ACP Protocol`）。
- 结束信号：`session.status{type:idle}` 或 `session.idle`；另有 `server.heartbeat`（约 30s）（`teleagent-mcp → README.md §ACP Protocol`）。
- 失败必须 `POST /session/:id/abort`，否则会话永远 busy（`TXGZ0777 → README.md:384`）。

### 5.6 为什么各家都要「保活 / 签到」

- **云电脑保活**：TeleAgent V3.0 的「智能体+云电脑」把任务放云端；平台按空闲/会话回收实例（实测 1–1.5 小时一次强制重置，`cloud-pc-bridge → README.md §背景`），所以有 CLINK 心跳/假鼠标（`teleai-keepalive → README.md:5-30`）和 `instance/connect` 换票（`teleagent-baohuo → README.md:5-15`）。
- **签到**：每日 100 积分是官方活动；社区脚本用 `checkDayTask`/`checkTask` 纯接口领取（`agent-auto-signin → README.md:6-30`）。
- **号池**：多账号是为了在限流/封号时切换（`dsh-teleagent-pool`、`AccountsHub`）；但对 Agent Deck 是明确红线。

### 5.7 版本差异（2026-11 的关键变化）

`dsh-teleagent-pool → README.md:46-74` 记录了 2.5.3 → 3.0.0-rc.1 的差异：
- 2.5.3：`X-SA-*` + `X-SuperAgent-Signature` 都发，sessionKey 客户端自造；
- 3.0.0-rc.1：仍发 `X-SA-*`，但 **`X-SuperAgent-Signature` 不再由客户端发**，sessionKey 只活在主进程内存；`Authorization` 变成 `Basic base64("super-agent:<随机串>")`（本地 IPC 用）。
- 结果：**3.0 下「自造签名直连」路线基本失效**，只能走内核（`anbulang`/`dsh-teleagent`/`TXGZ0777`）或等官方开放。

---

## 6. 对 obsidian-agent-deck 的取舍建议

与 [`../specs/teleagent-adapter.zh-CN.md`](../specs/teleagent-adapter.zh-CN.md) §3.5「明确不做」对齐：**只读追踪 + 复制交接**，不做内核、不做 API、不碰凭据。

| 类别 | 事项 | 理由 | 与 spec 对齐 |
|---|---|---|---|
| ✅ 可借鉴 | 只读 `teleagent.db`（`session/message/part`） | 社区多份证据确认与 OpenCode 同构；spec §2 已定义映射 | 一致 |
| ✅ 可借鉴 | 路径发现：`TELEAGENT_HOME` → `current-owner.json` → `users/<owner>/teleagent.db` | `dsh-teleagent` / `anbulang` 都这么找；多账号时取 mtime 最新 | 一致 |
| ✅ 可借鉴 | 启动器探测：`/usr/bin/teleagent` / `teleagent-launcher` / Windows exe / `open -a` | spec §3.4 已列；社区无更好方案 | 一致 |
| ✅ 可借鉴 | 深链 `teleai-cowork://` 仅用于「唤起客户端」 | 多份 README 确认协议已注册，但**是否支持会话参数未验证**；MVP 只唤起 + 复制 sid | 一致（spec §3.4） |
| ✅ 可借鉴 | `preset-context.json` / `model-catalog.json` 只读展示上下文与模型名 | `dsh-teleagent` 读 `preset-context.json`（`README.md:24`），`TXGZ0777` 读 `model-catalog.json`（`README.md:211-219`）；只读无副作用 | 新增（spec 未覆盖） |
| ⚠️ 有条件 | 会话级深链（带 sid 直达） | 需要实机抓一次协议；`teleai-cowork://` 的参数格式没有任何仓库给出 | spec 列为 P2 |
| ⚠️ 有条件 | `permission` 表派生「等你允许」 | spec 已列 P2，数据结构未验证；社区也没人做 | 一致 |
| ⚠️ 有条件 | 云电脑会话的 `workspace_id` 映射 | spec 说 68 个空 `directory`，不猜测；社区无映射表 | 一致 |
| ⛔ 禁止 | spawn 官方内核 / 调 4397、4399、47823 本地 API | 私有协议、无文档、升级即碎；且会与客户端抢 SQLite/端口 | spec §3.5 第 1 条 |
| ⛔ 禁止 | 读 `app-auth/token.json`、`local-key`、`SUPER_AGENT_LOCAL_SESSION_KEY` | 凭据泄露面；spec 明确不读 | spec §2.1、§3.5 |
| ⛔ 禁止 | 复刻 `X-Superagent-*` 签名 / 直连云网关 | 2026-11 起真验签；封号案例实锤（`40109`） | spec §3.5 |
| ⛔ 禁止 | 多账号池化 / 自动切换 | 违反 ToS 风险最高，且会顶掉桌面端登录 | spec §3.5 + 本文 §7 |
| ⛔ 禁止 | 保活 / 签到 / 云电脑电源操作 | 改服务器状态，与「只读追踪」定位冲突 | 新增红线 |
| ⛔ 禁止 | 把 MCP 工具注入内核 / 伪装官方客户端 | 签名覆盖 body、请求形态可识别；且无必要 | 新增红线 |

**一句话**：社区已经把「怎么把模型搬出来」研究透了，但那套东西对 Agent Deck 是**负资产**；我们只取「数据在哪、怎么读、怎么唤起」这三件事。

---

## 7. 风险与合规（事实 + 影响面）

| 风险 | 事实 | 影响面 |
|---|---|---|
| **账号封禁** | 网关有服务端风控，封禁是账号级：`40105 疑似攻击` → `40109 current user is banned`；封的是模型通道，积分接口仍正常（`dsh-connect-teleagent → README.md:213-223`；`opencode-teleagent-auth → README.md:311-334`） | 官方 App 一起用不了；申诉靠客服；常见 24h–7d |
| **真实案例** | 2026-10-27 两个账号因「5 模型 × 图片 × 50–600KB 填充体 × 合成工具名」的探测被封，第二个约 1h45m（`opencode-teleagent-auth → README.md:311-334`） | 证明「批量测模型/签名变体」是自杀式行为 |
| **ToS** | 多数项目自述「非官方、仅研究、自担风险」；`liao96312` 甚至写「下载后 24 小时内删除」（`teleagent-proxy-liao → README.md:1-10`） | 厂商立场未知；商用风险最高 |
| **凭据落盘** | token 多为明文 JWT（0600）；部分项目把面板密码、`accounts.json`、API key 表也落盘明文（`teleai-keepalive → README.md:100-120`；`TXGZ0777 → README.md:245-266`） | 本机多用户/备份/同步即泄露 |
| **账号共享/池化** | `dsh-teleagent-pool`、`AccountsHub`、多账号 provider 都在做「一号多用/多号轮换」 | 直接违反「仅本人账号」的常见条款；轮换还会把桌面端顶下线 |
| **逆向依赖** | 内核是私有协议；2.5.3→3.0 已改签名行为；快照里多个项目只有 1–3 次提交（`dsh-teleagent-pool → README.md:46-74`） | 任何自动化都需持续维护，不能当基础设施 |
| **供应链** | 生态多为 0–23 star 的个人仓库；npm 上 `dsh-teleagent`/`dsh-connect-teleagent` 从 README 看为个人发布；多数无 LICENSE 或未声明；安装即执行代码 | 供应链攻击面大；生产环境不应引入 |
| **法律/合规** | 央企产品、企业版含私有化部署与审计；把个人版额度搬到第三方工具违反服务条款 | 企业场景尤其不可用 |

---

## 8. 未验证清单 + 复核方式

| # | 未验证项 | 现状 | 复核方式 |
|---|---|---|---|
| 1 | Windows / macOS 数据路径与启动器 | 仅 README；Windows 路径三家说法冲突（`%APPDATA%` vs `%USERPROFILE%\.local\share`） | 在目标机装 TeleAgent 后 `ls` 两处；以 `current-owner.json` 为准 |
| 2 | 3.0.x 内核协议是否仍兼容社区结论 | 社区样本停在 2.7.1–3.0.0-rc.1；本机 3.x 未跑社区代理 | 只读跑一次 `sqlite3 -readonly` + `curl 127.0.0.1:4397/health`（不发业务请求） |
| 3 | `teleai-cowork://` 是否支持会话参数 | 只确认协议注册，无任何仓库给出参数格式 | 抓一次客户端唤起；或看 asar 里 scheme 处理 |
| 4 | `permission` 表能否派生待审批 | spec 列 P2，社区无人实现 | 只读建库样本，观察 `permission` 行 |
| 5 | 底层模型身份（GLM?） | 模型自报不稳定；magpie 测到 Z.ai/GLM 线索但不定版 | 不做；文档只写「未公开」 |
| 6 | star / 更新时间 | 2026-11-17 快照 | 复核时重跑 GitHub search |
| 7 | 许可证 | 多个仓库未见 LICENSE，本文标「未见」，不推测 | 打开仓库根目录确认 |
| 8 | Gitee 是否有镜像/同类 | Gitee 公开 API 检索 `teleagent` 返回空；未做登录态搜索 | 手动搜 <https://search.gitee.com/?q=teleagent> |
| 9 | `workctrl` npm 包是否相关 | 描述像 TeleAgent runner，但 README 是 `@teleagent/runner`、含泰文界面，未证实 | 看包作者与仓库；暂不计入 |
| 10 | `teleagent.cn` / `teleagent.tech` 是否官方 | 仅第三方 README 引用；官方域名为 `teleai.com.cn` / `ta.teleai.com.cn` | 以官网为准，不引用第三方域名 |

---

## 9. 关系图与时间线

```
官方（闭源）
  TeleAgent 客户端 3.x ──(本地 4397 内核)──┐
  Tele-AI/Telechat（开源模型，非 app）      │
  TeleAI-TeleAgent/ai-native-skill-compiler（疑似团队）│
                                          ▼
社区三条路线 ─────────────────────────────────────────────
  ① 内核代签：dsh-teleagent / anbulang-dsh / TXGZ0777 / TeleAgentCLI / ToAPI
  ② 自签直连：alvinhuang-dsh / liao-A / teleagent-auth / samiya / ddddx / magpie
  ③ 本地 server：liao-B / lizhun / teleagent-mcp / fnos（容器内跑客户端）
        │
        ├─ 账号配套：agent-auto-signin / baohuo / keepalive / pool / AccountsHub
        ├─ 技能/MCP：teleagent-skills / mcp-server / skill-builder / cctvgh×23 / zmx
        └─ 客户端封装：TeleAgentCLI / fnos / cloud-pc-bridge
同名无关：DeepPythonist（TG userbot）/ wty92911（Zellij teleport）/ woguaiwo（TG 桥）/ gt-del（AI 外呼）
```

**时间线（按仓库 pushed_at，均为 2026 年）**
- 06-17 `ddddx`（最早网关之一）；07-05 `teleagent-mcp`；07-18 官方 WAIC 发布
- 08-01 `lizhun`；10-13 `dsh-codearts-auth`/`liao96312`；10-16 `dsh-teleagent`；10-18 `teleagent-auth`；10-27 五层记忆 + 封号事件
- 11-03 `pool`；11-04 `ToAPI`；11-06 官方 V3.0；11-07 `alvinhuang`；11-09 `compiler`/`skill-builder`；11-10 `TeleAgentCLI`；11-11 `anbulang`；11-12 `lizhun`；11-13 `magpie`；11-14 `baohuo`；11-16 `cloud-pc-bridge`；11-17 `fnos`/`keepalive`

**适用场景**：想「在 DSH 里用 TeleAgent 模型」→ 三个 DSH 插件（按是否要工具/账号数选）；想「在任意 OpenAI 客户端用」→ 网关（Windows 选 TXGZ0777，macOS 选 lizhun，Linux 服务器选 ToAPI/CLI）；想「研究协议」→ liao96312 + TXGZ0777 + magpie；想「看数据/做追踪」→ 本文 §6，只读库。

---

## 10. 来源链接清单

**官方**
- TeleAgent 官网：<https://ta.teleai.com.cn/>
- 产品页：<https://www.teleai.com.cn/product/teleagent>
- 官方发布（WAIC 2026-07-18）：<https://finance.ifeng.com/c/8urYJCfXTpx>、<http://www.sasac.gov.cn/n4470048/n32559362/n34402201/n34402211/n34501563/c35669466/content.html>
- V3.0（2026-11-06）：<https://www.icloudnews.net/a/124791.html>
- TeleClaw 桌面版（4 月 30 日新闻，页面未标年份；命名关系未证实）：<https://www.chinatelecom.com.cn/ct/news/jtxw/166329.html>
- 官方开源模型：<https://github.com/Tele-AI/Telechat>、<https://github.com/Tele-AI/TeleChat2>

**DSH 插件**
- <https://github.com/KUMAKAIHA/dsh-teleagent>、<https://github.com/anbulang/dsh-connect-teleagent>、<https://github.com/alvinhuang0509-design/dsh-connect-teleagent>、<https://github.com/836157055/dsh-teleagent-pool>
- <https://github.com/caigou114/dsh-teleagent-skill-builder>、<https://github.com/ylzqmjxh/dsh-pet-teleagent>、<https://github.com/anye-99/dsh-codearts-auth>
- npm：<https://www.npmjs.com/package/dsh-teleagent>、<https://www.npmjs.com/package/dsh-connect-teleagent>

**网关 / 转 API**
- <https://github.com/lizhun781021/teleagent-openai-proxy>、<https://github.com/liao96312/teleagent-proxy>、<https://github.com/TXGZ0777/teleagent-proxy>
- <https://github.com/ddddx/teleagent2api>、<https://github.com/hj01857655/TeleAgent2api>、<https://github.com/samiya782/teleagent2api>
- <https://github.com/LiuChang1999/TeleAgentToAPI>、<https://github.com/T786279007/teleagent2api-deploy>

**鉴权 / 账号 / 保活**
- <https://github.com/cuddlesgiggles/teleagent-auth>、<https://github.com/anbulang/opencode-teleagent-auth>、<https://github.com/baijiu666/magpie-TeleAgent>、<https://github.com/goodtome/magpie-teleagent-login>
- <https://github.com/Minatoxiaohu/agent-auto-signin>、<https://github.com/ihpdc/teleagent-baohuo>、<https://github.com/xuexu/teleai-keepalive>
- <https://github.com/mojed123/teleagent-cloud-helper>、<https://github.com/hututu001/teleagent-qinglong-keepalive>、<https://github.com/LiuChang1999/TeleAgent-AccountsHub>、<https://github.com/TimerDev/teleagent-dashboard>

**MCP / 技能**
- <https://github.com/T786279007/teleagent-mcp>、<https://github.com/T786279007/teleagent-chat-skill>、<https://github.com/yuzhaopeng-up/teleagent-skills>
- <https://github.com/unknowgiant/teleagent-mcp-server>、<https://github.com/TeleAI-TeleAgent/ai-native-skill-compiler>、<https://github.com/Yenchih-coder/teleagent-zmx-webhook-teleagent-webhook->
- <https://github.com/david3832024-coder/teleagent-product-ppt-skill>、<https://github.com/danzhisuan/work_review_for_teleagent>、<https://github.com/juventini10/Five-layer-memory-system>、<https://github.com/cctvgh>（23 个技能仓库）

**客户端封装 / 同名无关**
- <https://github.com/LiuChang1999/TeleAgentCLI>、<https://github.com/mwh1987/fnos-teleagent>、<https://github.com/mwh1987/skills-teleagent-fork>、<https://github.com/geekma/cloud-pc-bridge>
- <https://github.com/DeepPythonist/TeleAgent>、<https://github.com/wty92911/teleagent>、<https://github.com/woguaiwo/TeleAgent>、<https://github.com/gt-del/TeleAgent>、<https://github.com/MatheusLTrindade/Teleagent>、<https://github.com/dexccv/Telegram-Agent>

---

## 附：检索口径（可复现）

```bash
# GitHub：157 条 teleagent / 115 条 in:name（2026-11-17）
curl -s "https://api.github.com/search/repositories?q=teleagent&sort=stars&per_page=100"
# npm / PyPI
curl -s "https://registry.npmjs.org/-/v1/search?text=teleagent&size=50"
curl -s "https://pypi.org/pypi/teleagent/json"   # 200，Telethon 机器人，无关
curl -s -o /dev/null -w "%{http_code}\n" "https://pypi.org/pypi/teleagent-cli/json"  # 404
```

> 说明：本文所有 star / 更新时间是 2026-11-17 快照；clone 的 33 个仓库只用于核对 README 与源码行号，未上传、未在仓库内提交。
