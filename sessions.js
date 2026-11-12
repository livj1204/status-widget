'use strict';
// 켜진 Claude Code 세션 읽기
// ① ~/.claude/sessions/<pid>.json : Claude가 세션마다 적어 두는 이름 · 상태(busy/idle) · 앱 세션 번호
// ② 그 세션의 대화 기록(.jsonl) 끝부분 : 컨텍스트 양 · 모델 · 지금 쓰는 도구 · 질문 대기
// ③ 대화 기록 옆 subagents 폴더 : 지금 일하는 에이전트(꼬마) 수
// 읽기만 하고 아무것도 고치지 않는다.
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const SESS_DIR = process.env.STATUS_WIDGET_SESSIONS || path.join(HOME, '.claude', 'sessions');
const PROJ_DIR = process.env.STATUS_WIDGET_PROJECTS || path.join(HOME, '.claude', 'projects');
const FAKE = !!process.env.STATUS_WIDGET_SESSIONS; // 시험용 가짜 세션은 프로세스 확인을 건너뛴다

const enc = p => String(p || '').replace(/[^a-zA-Z0-9]/g, '-');
const ASK = new Set(['AskUserQuestion', 'ExitPlanMode']);
// 금방 끝나는 도구가 오래 안 끝나면 권한 확인 창이 떠 있는 것으로 본다
const QUICK = /^(Read|Edit|Write|MultiEdit|NotebookEdit|Glob|Grep)$/;
const SLEEP_MS = 30 * 60000;

function alive(pid) {
  if (FAKE) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// 대화 기록 파일 찾기 (폴더 이름 = 작업 폴더 경로의 글자 아닌 것을 - 로 바꾼 것)
const tPath = new Map();
const tMiss = new Map();
function transcriptOf(s) {
  const hit = tPath.get(s.sessionId);
  if (hit && fs.existsSync(hit)) return hit;
  const miss = tMiss.get(s.sessionId);
  if (miss && Date.now() - miss < 30000) return null;
  let p = path.join(PROJ_DIR, enc(s.cwd), s.sessionId + '.jsonl');
  if (!fs.existsSync(p)) {
    p = null;
    try {
      for (const d of fs.readdirSync(PROJ_DIR)) {
        const q = path.join(PROJ_DIR, d, s.sessionId + '.jsonl');
        if (fs.existsSync(q)) {
          p = q;
          break;
        }
      }
    } catch (e) {}
  }
  if (p) tPath.set(s.sessionId, p);
  else tMiss.set(s.sessionId, Date.now());
  return p;
}

function blocks(m) {
  return m && Array.isArray(m.content) ? m.content : [];
}

// 끝에서부터 읽는다: 마지막 응답의 컨텍스트 양, 마지막 질문 뒤로 아직 안 끝난 도구
function parseTail(file, size, n) {
  const len = Math.min(size, n);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, len, size - len);
  } finally {
    fs.closeSync(fd);
  }
  const lines = buf.toString('utf8').split('\n');
  if (len < size) lines.shift(); // 잘린 첫 줄
  const info = { ctx: 0, model: '', pending: [], lastTool: 0, lastToolName: '', prompt: '' };
  const done = new Set();
  let turnStart = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l || l.charCodeAt(0) !== 123) continue;
    if (l.indexOf('"type":"assistant"') < 0 && l.indexOf('"type":"user"') < 0) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch (e) {
      continue;
    }
    if (o.isSidechain || !o.message) continue;
    const ts = Date.parse(o.timestamp) || 0;
    if (o.type === 'assistant') {
      const u = o.message.usage;
      if (!info.ctx && u) {
        info.ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
        info.model = String(o.message.model || '');
      }
      for (const b of blocks(o.message)) {
        if (b.type !== 'tool_use') continue;
        if (ts > info.lastTool) {
          info.lastTool = ts;
          info.lastToolName = b.name;
        }
        if (!turnStart && !done.has(b.id)) info.pending.push({ name: b.name, at: ts });
      }
    } else {
      const bs = blocks(o.message);
      const results = bs.filter(b => b.type === 'tool_result');
      if (results.length) {
        for (const b of results) done.add(b.tool_use_id);
        if (ts > info.lastTool) info.lastTool = ts;
      } else if (!turnStart) {
        turnStart = true; // 사람(또는 알림)이 보낸 메시지 = 이번 차례의 시작. 그 앞의 도구는 볼 필요 없다
        const c = o.message.content;
        const text = typeof c === 'string' ? c : bs.filter(b => b.type === 'text').map(b => b.text).join(' ');
        info.prompt = String(text || '').replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      }
    }
    if (info.ctx && turnStart) break;
  }
  return info;
}

const tailCache = new Map();
function readTail(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch (e) {
    return null;
  }
  const c = tailCache.get(file);
  if (c && c.size === st.size && c.mtime === st.mtimeMs) return c.info;
  let info = null;
  // 도구 결과가 아주 긴 줄이면 끝 256KB 안에 응답이 없을 수 있어 조금씩 넓힌다
  for (const n of [262144, 1048576, 4194304]) {
    try {
      info = parseTail(file, st.size, n);
    } catch (e) {
      info = null;
      break;
    }
    if (info.ctx || n >= st.size) break;
  }
  if (info && !info.ctx && c && c.info) {
    info.ctx = c.info.ctx;
    info.model = info.model || c.info.model;
  }
  tailCache.set(file, { size: st.size, mtime: st.mtimeMs, info });
  return info;
}

// 지금 일하는 에이전트 수 (대화 기록이 45초 안에 바뀐 것). 6초에 한 번만 센다
const kidCache = new Map();
function kidsOf(file, sid) {
  const now = Date.now();
  const c = kidCache.get(sid);
  if (c && now - c.at < 6000) return c.n;
  const dir = path.join(path.dirname(file), sid, 'subagents');
  let n = 0;
  const count = d => {
    try {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
        try {
          if (now - fs.statSync(path.join(d, f.name)).mtimeMs < 45000) n++;
        } catch (e) {}
      }
    } catch (e) {}
  };
  count(dir);
  const wf = path.join(dir, 'workflows');
  try {
    for (const w of fs.readdirSync(wf, { withFileTypes: true })) {
      if (!w.isDirectory()) continue;
      const wd = path.join(wf, w.name);
      try {
        if (now - fs.statSync(wd).mtimeMs > 6 * 3600000) continue; // 오래된 워크플로는 건너뛴다
      } catch (e) {
        continue;
      }
      count(wd);
    }
  } catch (e) {}
  kidCache.set(sid, { at: now, n });
  return n;
}

// claude-opus-5-5 → Opus 5.5
function prettyModel(m) {
  const r = /claude-([a-z]+)-(\d+)-(\d+)/i.exec(String(m || ''));
  if (!r) return '';
  return r[1].charAt(0).toUpperCase() + r[1].slice(1) + ' ' + r[2] + '.' + r[3];
}

function stateOf(reg, info, now) {
  const st = String(reg.status || '');
  const changed = Number(reg.statusUpdatedAt || reg.updatedAt || reg.startedAt) || now;
  const pend = info ? info.pending : [];
  const ask = pend.find(p => ASK.has(p.name));
  if (ask) return { state: 'wait', why: ask.name === 'ExitPlanMode' ? 'plan' : 'ask', tool: '', since: ask.at || changed };
  if (st === 'busy') {
    const stuck = pend.find(p => QUICK.test(p.name) && now - p.at > 25000);
    if (stuck) return { state: 'wait', why: 'perm', tool: stuck.name, since: stuck.at };
    if (pend.length) return { state: 'busy', why: '', tool: pend[0].name, since: changed };
    if (info && now - info.lastTool < 20000) return { state: 'busy', why: '', tool: info.lastToolName, since: changed };
    return { state: 'think', why: '', tool: '', since: changed };
  }
  if (st === 'idle' || !st) return { state: now - changed > SLEEP_MS ? 'sleep' : 'idle', why: '', tool: '', since: changed };
  return { state: 'wait', why: st, tool: '', since: changed }; // 모르는 상태 = 사람을 기다리는 것으로
}

function scan() {
  const now = Date.now();
  let names = [];
  try {
    names = fs.readdirSync(SESS_DIR).filter(f => /^\d+\.json$/.test(f));
  } catch (e) {
    return [];
  }
  const out = [];
  for (const f of names) {
    let reg;
    try {
      reg = JSON.parse(fs.readFileSync(path.join(SESS_DIR, f), 'utf8'));
    } catch (e) {
      continue;
    }
    if (!reg || !reg.sessionId || !alive(Number(reg.pid))) continue;
    const file = transcriptOf(reg);
    const info = file ? readTail(file) : null;
    const s = stateOf(reg, info, now);
    const host = /^local_[A-Za-z0-9-]{1,64}$/.test(String(reg.hostSessionId || '')) ? reg.hostSessionId : '';
    out.push({
      id: reg.sessionId,
      host,
      name: String(reg.name || (info && info.prompt) || path.basename(String(reg.cwd || '')) || '세션').slice(0, 80),
      folder: path.basename(String(reg.cwd || '')),
      app: String(reg.entrypoint || ''),
      state: s.state,
      why: s.why,
      tool: s.tool,
      since: s.since,
      started: Number(reg.startedAt) || 0,
      ctx: info ? info.ctx : 0,
      model: prettyModel(info && info.model),
      kids: file ? kidsOf(file, reg.sessionId) : 0
    });
  }
  return out;
}

module.exports = { scan, SESS_DIR, PROJ_DIR, prettyModel, stateOf, parseTail };
