import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { resolveSqliteBinary } from '../src/sqlite.js';
import { teleAgentDatabases, teleAgentHome, teleAgentOwners } from '../src/teleagent.js';
import { stripTeleAgentContext } from '../src/prompt-text.js';
import { desktopMessages, desktopSessions } from '../src/desktop-sessions.js';
import { AgentUsage } from '../src/readers.js';
import { AGENTS, DEFAULTS, deepMerge } from '../src/constants.js';
import * as J from '../src/journal.js';

const quote = (x) => "'" + String(typeof x === 'object' ? JSON.stringify(x) : x).replaceAll("'", "''") + "'";
const sql = (db, s) => execFileSync(resolveSqliteBinary(), [db, s], { stdio: 'pipe' });
const now = Date.now() - 60000;

function makeRoot(owners) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-teleagent-'));
  for (const owner of owners) {
    const dir = path.join(root, 'users', owner);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'teleagent.db'), '');
  }
  return root;
}

test('teleAgentHome honors SUPER_AGENT_APP_DATA_DIR and falls back per platform', () => {
  const home = path.join(os.tmpdir(), 'ad-teleagent-home');
  // 内核注入的环境变量优先
  assert.equal(teleAgentHome({ SUPER_AGENT_APP_DATA_DIR: 'C:\\data\\TA\\' }, 'win32', home).replace(/\\/g, '/'), 'C:/data/TA');
  // Windows 上 LOCALAPPDATA 里真有 users/ 才采用（布局是 %LOCALAPPDATA%\TeleAgent\users\...）
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-teleagent-appdata-'));
  const local = path.join(appData, 'TeleAgent');
  fs.mkdirSync(path.join(local, 'users', 'owner'), { recursive: true });
  assert.equal(teleAgentHome({ LOCALAPPDATA: appData }, 'win32', home).replace(/\\/g, '/'), local.replace(/\\/g, '/'));
  assert.equal(teleAgentHome({ LOCALAPPDATA: path.join(appData, 'nope') }, 'win32', home).replace(/\\/g, '/'), `${home.replace(/\\/g, '/')}/.local/share/TeleAgent`);
  // 没有环境变量时是 ~/.local/share/TeleAgent（macOS/Linux/Windows 同一套布局）
  assert.equal(teleAgentHome({}, 'linux', home).replace(/\\/g, '/'), `${home.replace(/\\/g, '/')}/.local/share/TeleAgent`);
  assert.equal(teleAgentHome({}, 'darwin', home).replace(/\\/g, '/'), `${home.replace(/\\/g, '/')}/.local/share/TeleAgent`);
});

test('teleAgentOwners puts the current account first and keeps the other accounts', () => {
  const root = makeRoot(['v1_public_2', 'v1_public_1']);
  fs.writeFileSync(path.join(root, 'current-owner.json'), JSON.stringify({ ownerDir: 'v1_public_1', tenantId: 'public' }));
  fs.mkdirSync(path.join(root, 'users', '.DS_Store'), { recursive: true });
  assert.deepEqual(teleAgentOwners(root), ['v1_public_1', 'v1_public_2']);
  // 目录名里带分隔符或点号的条目不是账号，跳过避免路径穿越
  fs.writeFileSync(path.join(root, 'current-owner.json'), JSON.stringify({ ownerDir: '../escape' }));
  assert.deepEqual(teleAgentOwners(root), ['v1_public_1', 'v1_public_2']);
});

test('teleAgentDatabases only returns existing account databases', () => {
  const root = makeRoot(['v1_public_1']);
  fs.writeFileSync(path.join(root, 'current-owner.json'), JSON.stringify({ ownerDir: 'v1_public_1' }));
  fs.mkdirSync(path.join(root, 'users', 'v1_public_empty'), { recursive: true });
  const dbs = teleAgentDatabases({ env: { SUPER_AGENT_APP_DATA_DIR: root }, platform: 'win32', homeDir: root });
  assert.equal(dbs.length, 1);
  assert.ok(dbs[0].replace(/\\/g, '/').endsWith('/users/v1_public_1/teleagent.db'));
});

test('TeleAgent sessions are tracked from the real session/message/part schema', async () => {
  const root = makeRoot(['v1_public_owner']);
  fs.writeFileSync(path.join(root, 'current-owner.json'), JSON.stringify({ ownerDir: 'v1_public_owner' }));
  const db = path.join(root, 'users', 'v1_public_owner', 'teleagent.db');
  const sid = 'ses_tele_demo_001';
  sql(db, `CREATE TABLE session(id,title,directory,parent_id,time_created,time_updated,time_archived);
    CREATE TABLE message(id,session_id,time_created,time_updated,data);
    CREATE TABLE part(id,message_id,session_id,time_created,time_updated,data);
    INSERT INTO session VALUES('${sid}','培训 PPT 规划','E:\\Project\\demo',NULL,${now},${now + 1000},NULL);
    INSERT INTO message VALUES('u','${sid}',${now},${now},${quote({ role: 'user', time: { created: now } })}),
      ('a','${sid}',${now + 1000},${now + 1000},${quote({
        role: 'assistant', modelID: 'chat-pro',
        time: { created: now + 1000, completed: now + 2000 },
        tokens: { input: 120, output: 30, cache: { read: 40, write: 10 } },
        finish: 'stop',
      })});
    INSERT INTO part VALUES('p1','u','${sid}',${now},${now},${quote({ type: 'text', text: '<span data-path-name="D:/secret/report.pdf" data-path-kind="file">@report.pdf</span> 帮我看看这份材料' })}),
      ('p2','a','${sid}',${now},${now},${quote({ type: 'text', text: '材料已读完' })});`);

  const prev = process.env.SUPER_AGENT_APP_DATA_DIR;
  process.env.SUPER_AGENT_APP_DATA_DIR = root;
  try {
    const settings = deepMerge(DEFAULTS, { agents: { teleagent: true }, primaryAgents: [] });
    const usage = new AgentUsage({ settings, cfg: settings });
    assert.deepEqual(usage.desktopDatabases().filter(([, a]) => a === 'teleagent').map(([p]) => p.replace(/\\/g, '/')), [db.replace(/\\/g, '/')]);
    // 只读夹具库：不要让扫描去读本机真实的 Claude/Codex 目录和别的桌面库
    usage.roots = () => [];
    usage.desktopDatabases = () => [[db, 'teleagent']];
    await usage.scan({ since: 0 });
    const meta = usage.meta.get(sid);
    assert.ok(meta, 'TeleAgent session must be discovered');
    assert.equal(meta.agent, 'teleagent');
    assert.equal(meta.title, '培训 PPT 规划');
    assert.equal(meta.cwd, 'E:\\Project\\demo');
    assert.equal(meta.out, 30);
    assert.equal(meta.fresh, 130, 'input + cache.write');
    assert.equal(meta.cached, 40, 'cache.read');
    assert.equal(meta.lastText, '材料已读完');
    assert.equal(meta.state, 'wait');
    // 附件 span 的绝对路径不能进会话视图
    const messages = await desktopMessages(db, 'teleagent', sid);
    const user = messages.find((m) => m.role === 'user');
    assert.ok(user.text.startsWith('@report.pdf'));
    assert.ok(!user.text.includes('secret'));
  } finally {
    if (prev === undefined) delete process.env.SUPER_AGENT_APP_DATA_DIR; else process.env.SUPER_AGENT_APP_DATA_DIR = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stripTeleAgentContext keeps the visible attachment name and drops absolute paths', () => {
  const raw = '<span data-path-name="C:/Users/x/secret/a.pdf" data-path-kind="file">@a.pdf</span> 请总结这个文件';
  assert.equal(stripTeleAgentContext(raw), '@a.pdf 请总结这个文件');
  assert.equal(stripTeleAgentContext('<span data-path-kind="image"></span>看图'), '看图');
  assert.equal(stripTeleAgentContext('普通提问'), '普通提问');
});

test('TeleAgent is registered as a desktop-only tracking agent', () => {
  assert.equal(AGENTS.teleagent.desktopOnly, true);
  assert.equal(AGENTS.teleagent.trackingOnly, true);
  assert.equal(DEFAULTS.agents.teleagent, true);
});

test('TeleAgent journal links round-trip through the deck scheme and get the ta block prefix', () => {
  const line = J.linkLine('', 'teleagent', '培训 PPT 规划', 'ses_tele_demo_001');
  assert.ok(line.includes('🔗 [TeleAgent：培训 PPT 规划](obsidian://agent-deck?do=open&agent=teleagent&sid=ses_tele_demo_001)'), line);
  assert.deepEqual(J.parseLink(line), { agent: 'teleagent', sid: 'ses_tele_demo_001', title: '培训 PPT 规划' });
  const blockId = J.makeBlockId('ses_tele_demo_001', 'teleagent', 'demo');
  assert.ok(blockId.startsWith('ta-demo-'), blockId);
  assert.equal(J.isDeckBlockId(blockId), true);
});
