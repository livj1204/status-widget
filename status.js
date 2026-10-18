'use strict';
// STATUS.md 읽기·쓰기.
// 칸: "## 프로젝트"(있으면), "## 할 일"(순서 = 우선순위), "## 보류", "## 완료". 이름이 다른 칸의 항목은 할 일로 본다.
// 한 줄: "- [ ] [태그] 제목 — 설명 ← 메모리 파일". 태그·설명·파일은 없어도 된다.
// 완료 칸의 줄은 "- [x] ... (완료 10/17) ← 파일"처럼 끝난 날짜를 붙인다.
// 프로젝트 줄 밑에 들여쓴 "- [x] / - [>] / - [ ]"는 단계다. [>]가 지금 하는 단계.
// 위젯에서 추가한 줄은 "— 10/18 추가"가 붙고, 날짜를 고르면 "· 날짜 10/31 · 물어보기(또는 알림만)"도 붙는다.

const ITEM_RE = /^- \[( |x|X)\] (.*)$/;
const STEP_RE = /^(\s+)- \[( |x|X|>)\] (.*)$/;
const HEAD_RE = /^##\s+(.+?)\s*$/;
const TAG_RE = /^\[([^\]]{1,8})\]\s*/;
const DATE_RE = /(\d{1,2})\/(\d{1,2})/;
const DONE_MARK_RE = /\s*\(완료 (\d{1,2}\/\d{1,2})\)\s*$/;
const ADDED_RE = /(\d{1,2})\/(\d{1,2}) 추가/;
const WHEN_RE = /날짜 (\d{1,2})\/(\d{1,2})/;
const ASKED_RE = /\d{1,2}\/\d{1,2} 물어봄/;
const META_RE = /\d{1,2}\/\d{1,2} (추가|물어봄)/g;
const TAGS = { '마감': 'due', '진행': 'doing', '대기': 'wait', '설치': 'install', '확인': 'check' };
const TAG_OF = { due: '마감', doing: '진행', wait: '대기', install: '설치', check: '확인' };
const TITLES = { proj: '프로젝트', todo: '할 일', hold: '보류', done: '완료' };

function trimBlank(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function parse(text) {
  const lines = stripBom(String(text)).replace(/\r\n/g, '\n').split('\n');
  const doc = { preamble: [], sections: [] };
  let sec = null;
  let last = null;
  for (const line of lines) {
    const h = HEAD_RE.exec(line);
    if (h) {
      sec = { title: h[1], items: [], extra: [] };
      doc.sections.push(sec);
      last = null;
      continue;
    }
    if (!sec) {
      doc.preamble.push(line);
      continue;
    }
    const m = ITEM_RE.exec(line);
    if (m) {
      last = { done: m[1] !== ' ', body: m[2], cont: [] };
      sec.items.push(last);
    } else if (last && /^\s+\S/.test(line)) {
      last.cont.push(line); // 항목 밑에 들여쓴 줄은 그 항목에 붙인다
    } else {
      if (line.trim()) last = null;
      sec.extra.push(line);
    }
  }
  return doc;
}

function serialize(doc, eol) {
  const out = trimBlank(doc.preamble).slice();
  for (const sec of doc.sections) {
    out.push('', '## ' + sec.title);
    for (const it of sec.items) {
      out.push('- [' + (it.done ? 'x' : ' ') + '] ' + it.body);
      for (const c of it.cont) out.push(c);
    }
    const extra = trimBlank(sec.extra);
    if (extra.length) {
      if (sec.items.length) out.push('');
      for (const l of extra) out.push(l);
    }
  }
  return out.join(eol || '\n') + (eol || '\n');
}

function areaOf(sec) {
  const t = sec.title.trim();
  if (t === TITLES.proj) return 'proj';
  if (t === TITLES.hold) return 'hold';
  if (t === TITLES.done) return 'done';
  return 'todo';
}

// 같은 내용의 줄이 여러 개여도 구분되도록 "몇 번째:본문"을 키로 쓴다.
function keyed(doc, fn) {
  const seen = new Map();
  for (const sec of doc.sections) {
    sec.items.forEach((it, idx) => {
      const n = seen.get(it.body) || 0;
      seen.set(it.body, n + 1);
      fn(n + ':' + it.body, it, sec, idx);
    });
  }
}

function splitRef(body) {
  const arrow = body.lastIndexOf('←');
  if (arrow < 0) return { main: body.trim(), ref: '' };
  return { main: body.slice(0, arrow).trim(), ref: body.slice(arrow + 1).trim() };
}

function joinRef(main, ref) {
  return ref ? main + ' ← ' + ref : main;
}

function withMark(body, date) {
  const p = splitRef(body);
  return joinRef(p.main.replace(DONE_MARK_RE, '') + ' (완료 ' + date + ')', p.ref);
}

function withoutMark(body) {
  const p = splitRef(body);
  return joinRef(p.main.replace(DONE_MARK_RE, ''), p.ref);
}

function describe(key, it, area) {
  let { main, ref } = splitRef(it.body);
  let doneAt = '';
  const mark = DONE_MARK_RE.exec(main);
  if (mark) {
    doneAt = mark[1];
    main = main.slice(0, mark.index).trim();
  }
  let tag = '';
  const t = TAG_RE.exec(main);
  if (t && TAGS[t[1].trim()]) {
    tag = t[1].trim();
    main = main.slice(t[0].length);
  }
  let title = main;
  let sub = '';
  const dash = main.indexOf(' — ');
  if (dash > 0) {
    title = main.slice(0, dash).trim();
    sub = main.slice(dash + 3).trim();
  }
  const cat = TAGS[tag] || 'etc';
  const dateOf = re => {
    const d = re.exec(main.replace(META_RE, ''));
    return d ? { m: Number(d[1]), d: Number(d[2]) } : null;
  };
  // 위젯에서 직접 넣은 줄: 날짜(날짜 M/D, 없으면 글 속 M/D)·알림 방식·물어봤는지
  const added = ADDED_RE.exec(sub);
  const user = !!added;
  let due = null;
  let kind = '';
  let asked = false;
  let note = '';
  if (user) {
    due = dateOf(WHEN_RE) || dateOf(DATE_RE);
    kind = /알림만/.test(sub) ? 'notify' : 'ask';
    asked = ASKED_RE.test(sub);
    note = sub.slice(0, added.index).replace(/\s*—\s*$/, '').trim();
  } else if (cat === 'due') {
    due = dateOf(DATE_RE);
  }
  return { key, tag, cat, title, sub, ref, doneAt, full: it.body, done: it.done, area, due, user, kind, asked, note };
}

// 프로젝트 줄 밑의 단계들: [x] 끝남 · [>] 지금 · [ ] 남음
function stepsOf(it) {
  const out = [];
  it.cont.forEach((line, ci) => {
    const m = STEP_RE.exec(line);
    if (m) out.push({ ci, state: m[2] === '>' ? 'now' : m[2] === ' ' ? 'todo' : 'done', text: m[3].trim() });
  });
  return out;
}

function setStep(it, step, state) {
  const m = STEP_RE.exec(it.cont[step.ci]);
  it.cont[step.ci] = m[1] + '- [' + (state === 'done' ? 'x' : state === 'now' ? '>' : ' ') + '] ' + m[3];
}

function view(doc) {
  const out = { proj: [], todo: [], hold: [], done: [] };
  keyed(doc, (key, it, sec) => {
    const area = areaOf(sec);
    const v = describe(key, it, area);
    if (area === 'proj') v.steps = stepsOf(it).map(s => ({ state: s.state, text: s.text }));
    out[area].push(v);
  });
  return out;
}

function clone(doc) {
  return {
    preamble: doc.preamble.slice(),
    sections: doc.sections.map(s => ({
      title: s.title,
      items: s.items.map(i => ({ done: i.done, body: i.body, cont: i.cont.slice() })),
      extra: s.extra.slice()
    }))
  };
}

// 한 칸(할 일·보류·완료)의 항목들을 순서대로 이어 붙인 자리 목록
function slots(doc, area) {
  const out = [];
  for (const sec of doc.sections) {
    if (areaOf(sec) !== area) continue;
    sec.items.forEach((_, idx) => out.push({ sec, idx }));
  }
  return out;
}

function sectionFor(doc, area) {
  let sec = doc.sections.find(s => areaOf(s) === area);
  if (!sec) {
    sec = { title: TITLES[area], items: [], extra: [] };
    if (area === 'todo') {
      doc.sections.unshift(sec);
    } else if (area === 'hold') {
      const doneAt = doc.sections.findIndex(s => areaOf(s) === 'done');
      if (doneAt >= 0) doc.sections.splice(doneAt, 0, sec);
      else doc.sections.push(sec);
    } else {
      doc.sections.push(sec);
    }
  }
  return sec;
}

function insertAt(doc, area, pos, item) {
  const list = slots(doc, area);
  if (pos < list.length) list[pos].sec.items.splice(list[pos].idx, 0, item);
  else if (list.length) list[list.length - 1].sec.items.push(item);
  else sectionFor(doc, area).items.push(item);
}

function find(doc, key) {
  let found = null;
  keyed(doc, (k, it, sec, idx) => {
    if (!found && k === key) found = { it, sec, idx, area: areaOf(sec) };
  });
  return found;
}

function today() {
  const d = new Date();
  return (d.getMonth() + 1) + '/' + d.getDate();
}

function applyOp(input, op) {
  const doc = clone(input);
  const date = op.date || today();

  if (op.type === 'add') {
    const text = String(op.text || '').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('내용이 비어 있어요');
    const tag = TAG_OF[op.cat] || '대기';
    let body = '[' + tag + '] ' + text + ' — ' + date + ' 추가';
    if (/^\d{1,2}\/\d{1,2}$/.test(String(op.due || ''))) body += ' · 날짜 ' + op.due + ' · ' + (op.kind === 'notify' ? '알림만' : '물어보기');
    insertAt(doc, 'todo', 3, { done: false, body, cont: [] });
    return doc;
  }

  if (op.type === 'cleanup') {
    const moved = [];
    for (const sec of doc.sections) {
      if (areaOf(sec) === 'done') continue;
      sec.items = sec.items.filter(it => {
        if (!it.done) return true;
        moved.push(it);
        return false;
      });
    }
    if (!moved.length) return doc;
    moved.reverse().forEach(it => insertAt(doc, 'done', 0, { done: true, body: withMark(it.body, date), cont: it.cont }));
    return doc;
  }

  const found = find(doc, op.key);
  if (!found) throw new Error('그 줄이 파일에서 바뀌었거나 사라졌어요');
  const { it, sec, idx, area } = found;
  const take = () => sec.items.splice(idx, 1)[0];

  switch (op.type) {
    case 'toggle':
      it.done = !it.done;
      break;
    case 'step': {
      // 단계 체크: 끝난 것을 누르면 다시 남음으로. 지금 하던 단계를 끝내면 다음 남은 단계가 지금이 된다
      const steps = stepsOf(it);
      const s = steps[op.idx];
      if (!s) throw new Error('그 단계가 파일에서 바뀌었어요');
      if (s.state === 'done') {
        setStep(it, s, 'todo');
      } else {
        setStep(it, s, 'done');
        if (s.state === 'now') {
          const next = steps.slice(op.idx + 1).find(x => x.state !== 'done');
          if (next && !steps.some(x => x !== s && x.state === 'now')) setStep(it, next, 'now');
        }
      }
      break;
    }
    case 'asked': {
      // 위젯이 날짜 알림으로 물어봤으면 표시해서 Claude가 다시 묻지 않게 한다
      const p = splitRef(it.body);
      if (!ASKED_RE.test(p.main)) it.body = joinRef(p.main + ' · ' + date + ' 물어봄', p.ref);
      break;
    }
    case 'remove':
    case 'purge':
      take();
      break;
    case 'hold':
      // 보류 안에서 누르면 다시 할 일로 (예전 동작과 같게)
      take();
      it.done = false;
      if (area === 'hold') insertAt(doc, 'todo', 3, it);
      else insertAt(doc, 'hold', 0, { done: false, body: withoutMark(it.body), cont: it.cont });
      break;
    case 'restore':
      take();
      insertAt(doc, 'todo', 3, { done: false, body: withoutMark(it.body), cont: it.cont });
      break;
    case 'complete':
      take();
      insertAt(doc, 'done', 0, { done: true, body: withMark(it.body, date), cont: it.cont });
      break;
    case 'top':
      take();
      insertAt(doc, area === 'done' ? 'done' : area, 0, it);
      break;
    case 'up':
    case 'down': {
      const list = slots(doc, area);
      const at = list.findIndex(s => s.sec === sec && s.idx === idx);
      const to = at + (op.type === 'up' ? -1 : 1);
      if (to < 0 || to >= list.length) return doc;
      const other = list[to];
      const moved = other.sec.items[other.idx];
      other.sec.items[other.idx] = it;
      sec.items[idx] = moved;
      break;
    }
    case 'move': {
      // 끌어서 놓기: target 줄의 앞(after=false)이나 뒤(after=true), 또는 zone(보류·완료 칸)
      if (op.zone === 'hold' || op.zone === 'done' || op.zone === 'todo') {
        take();
        if (op.zone === 'done') insertAt(doc, 'done', 0, { done: true, body: withMark(it.body, date), cont: it.cont });
        else if (op.zone === 'hold') insertAt(doc, 'hold', 0, { done: false, body: withoutMark(it.body), cont: it.cont });
        else insertAt(doc, 'todo', slots(doc, 'todo').length, { done: false, body: withoutMark(it.body), cont: it.cont });
        break;
      }
      if (op.target === op.key) return doc;
      take();
      const target = find(doc, op.target);
      if (!target) throw new Error('놓을 자리가 사라졌어요');
      const list = slots(doc, target.area);
      const at = list.findIndex(s => s.sec === target.sec && s.idx === target.idx) + (op.after ? 1 : 0);
      let item = it;
      if (target.area === 'done' && area !== 'done') item = { done: true, body: withMark(it.body, date), cont: it.cont };
      if (target.area !== 'done' && area === 'done') item = { done: false, body: withoutMark(it.body), cont: it.cont };
      if (target.area === 'hold') item.done = false;
      insertAt(doc, target.area, at, item);
      break;
    }
    default:
      throw new Error('모르는 동작: ' + op.type);
  }
  return doc;
}

module.exports = { parse, serialize, view, applyOp };
