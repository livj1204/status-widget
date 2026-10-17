'use strict';
(function () {
  const api = window.statusApi;
  const $ = id => document.getElementById(id);
  const body = document.body;
  const nodes = new Map();
  const DAY = 86400000;
  let current = null;
  let busy = false;
  let flashKey = null;
  let menuKey = null;
  let stay = false;
  let open = false;
  let ignoring = true;
  let closeTimer = null;
  let openTimer = null;
  let toastTimer = null;
  let newTimer = null;
  let note = '';
  let dragKey = null;
  let over = null;
  let addCat = 'wait';
  let wallInfo = null;
  let winBounds = null;
  let hovering = false;
  let pinned = false; // 이번에만 고정 (알약 클릭). 영구 고정(stay)은 트레이 메뉴
  let suppressHover = false; // ˄로 접은 직후 알약 위에 커서가 있어도 바로 다시 펼치지 않게
  let peekAt = 0;

  const svg = (inner, size, stroke) =>
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + stroke +
    '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';

  const CAT_ICON = {
    due: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    doing: '<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5"/><path d="M12 8v4l2.5 2.5"/>',
    wait: '<path d="M7 4h10"/><path d="M7 20h10"/><path d="M8 4c0 4.5 8 5 8 8s-8 3.5-8 8"/><path d="M16 4c0 4.5-8 5-8 8s8 3.5 8 8"/>',
    install: '<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
    check: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    etc: '<circle cx="12" cy="12" r="2.5"/>'
  };
  const CATS = [
    { key: 'due', name: '마감' },
    { key: 'doing', name: '진행' },
    { key: 'wait', name: '대기' },
    { key: 'install', name: '설치' },
    { key: 'check', name: '확인' }
  ];

  const chipBtn = (cls, op, label) => '<button class="chipBtn ' + cls + '" type="button" data-op="' + op + '">' + label + '</button>';
  const TEMPLATE =
    '<div class="line">' +
    '<span class="grip" aria-hidden="true"></span>' +
    '<button class="cb" type="button" data-op="toggle" aria-label="체크해서 줄 긋기" aria-pressed="false">' +
    svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 12, 3.2) + '</button>' +
    '<div class="body"><span class="tl"><span class="t"></span></span><span class="s"><i class="ic"></i><span class="st"></span></span></div>' +
    '<span class="chip" hidden></span>' +
    '<button class="ib sm more" type="button" data-op="menu" aria-label="더 보기" aria-expanded="false" title="더 보기">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg></button>' +
    '</div>' +
    '<div class="bar" hidden>' +
    chipBtn('c-top', 'top', '지금 할 것으로') +
    chipBtn('c-hold', 'hold', '보류') +
    chipBtn('c-restore-hold', 'restore', '다시 할 일로') +
    chipBtn('c-restore-done', 'restore', '되살리기') +
    chipBtn('go c-complete', 'complete', '완료로') +
    chipBtn('danger c-purge', 'purge', '영구 삭제') +
    '</div>';

  const wait = ms => new Promise(r => setTimeout(r, ms));

  function ddayOf(v) {
    if (!v.due) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let at = new Date(today.getFullYear(), v.due.m - 1, v.due.d);
    if (at - today < -60 * DAY) at = new Date(today.getFullYear() + 1, v.due.m - 1, v.due.d);
    const n = Math.round((at - today) / DAY);
    return { n, text: n > 0 ? 'D-' + n : n === 0 ? 'D-day' : 'D+' + -n };
  }

  function hhmm(ms) {
    const d = ms ? new Date(ms) : new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  // ── 바탕화면 그림을 그릇 안에 맞춰 깔기 ──
  function placeWall() {
    if (!wallInfo || !wallInfo.layer || !winBounds) return;
    const layer = wallInfo.layer;
    for (const host of [$('pill'), $('panel')]) {
      const wp = host.querySelector('.wp');
      wp.style.left = (layer.x - winBounds.x - host.offsetLeft) + 'px';
      wp.style.top = (layer.y - winBounds.y - host.offsetTop) + 'px';
      wp.style.width = layer.w + 'px';
      wp.style.height = layer.h + 'px';
    }
  }

  function setWall(info) {
    if (!info || !info.wall) return;
    const w = info.wall;
    const changed = !wallInfo || wallInfo.wall.url !== w.url;
    wallInfo = { wall: w, layer: info.layer || (wallInfo && wallInfo.layer) };
    if (info.bounds) winBounds = info.bounds;
    for (const wp of document.querySelectorAll('.wp')) {
      if (changed) wp.style.backgroundImage = w.url ? 'url("' + w.url + '")' : 'none';
      wp.style.backgroundColor = w.bg;
      wp.style.backgroundSize = w.size;
      wp.style.backgroundPosition = w.position;
      wp.style.backgroundRepeat = w.repeat;
    }
    placeWall();
  }

  // ── 접기·펼치기와 클릭 통과 ──
  function setOpen(on) {
    clearTimeout(closeTimer);
    clearTimeout(openTimer);
    if (open === on) return;
    open = on;
    body.classList.toggle('is-open', on);
    if (!on) {
      closeMenu();
      setIgnore(true);
    }
  }

  function setIgnore(on) {
    if (ignoring === on) return;
    ignoring = on;
    api.setIgnore(on);
  }

  function canAutoClose() {
    return !pinned && !dragKey && $('addBox').hidden;
  }

  function setPinned(on) {
    pinned = !!on;
    body.classList.toggle('is-pinned', pinned);
    api.setTop(pinned); // 고정하면 다른 창 위에도 떠 있게
    const b = $('pinBtn');
    b.setAttribute('aria-label', pinned ? '접기 (다시 자동으로)' : '펼친 채로 고정');
    b.title = pinned ? '접기 — 다시 자동으로' : '펼친 채로 고정 (다른 창 위에도)';
    if (pinned) setOpen(true);
  }

  function scheduleClose() {
    if (!open || !canAutoClose()) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (canAutoClose()) setOpen(false);
    }, 900);
  }

  document.addEventListener('mousemove', e => {
    const host = e.target.closest ? e.target.closest('.host') : null;
    const active = open ? $('panel') : $('pill');
    const inside = host === active;
    hovering = inside;
    setIgnore(!inside);
    if (!inside && !open) suppressHover = false;
    if (inside) {
      clearTimeout(closeTimer);
      if (!open && !openTimer && !suppressHover) {
        openTimer = setTimeout(() => {
          openTimer = null;
          peekAt = Date.now();
          setOpen(true);
        }, 140);
      }
    } else {
      clearTimeout(openTimer);
      openTimer = null;
      scheduleClose();
    }
  });
  document.addEventListener('mouseout', e => {
    if (e.relatedTarget) return; // 창 밖으로 나갔을 때만
    clearTimeout(openTimer);
    openTimer = null;
    scheduleClose();
  });
  $('pillBtn').addEventListener('click', () => setPinned(true));

  // 알약을 누르려는 사이 커서 때문에 먼저 펼쳐졌어도, 펼친 직후 알약 자리를 누르면 고정으로 본다
  document.addEventListener('click', e => {
    if (!open || pinned || Date.now() - peekAt > 900) return;
    const p = $('pill');
    const x = e.clientX;
    const y = e.clientY;
    if (x < p.offsetLeft || x > p.offsetLeft + p.offsetWidth || y < p.offsetTop || y > p.offsetTop + p.offsetHeight) return;
    e.preventDefault();
    e.stopPropagation();
    setPinned(true);
  }, true);

  // ── 한 줄 만들기·채우기 ──
  function make() {
    const el = document.createElement('div');
    el.innerHTML = TEMPLATE;
    el.draggable = true;
    el.addEventListener('click', e => {
      const b = e.target.closest('button[data-op]');
      if (!b) return;
      if (b.dataset.op === 'menu') toggleMenu(el);
      else act(b.dataset.op, el);
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      toggleMenu(el, true);
    });
    el.addEventListener('dragstart', e => {
      dragKey = el.dataset.key;
      closeMenu();
      try {
        e.dataTransfer.setData('text/plain', dragKey);
        e.dataTransfer.effectAllowed = 'move';
      } catch (err) {}
      requestAnimationFrame(() => el.classList.add('is-dragging'));
    });
    el.addEventListener('dragend', endDrag);
    el.addEventListener('dragover', e => {
      if (!dragKey || dragKey === el.dataset.key) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setOver({ el, key: el.dataset.key, after: e.clientY > r.top + r.height / 2 });
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      dropNow();
    });
    return el;
  }

  function fill(el, v, mode) {
    el.dataset.key = v.key;
    const cls = ['it', mode === 'focus' ? 'card' : 'row', 'cat-' + v.cat];
    if (v.done) cls.push('is-done');
    if (mode === 'held') cls.push('is-held');
    if (mode === 'done') cls.push('is-donearea');
    if (menuKey === v.key) cls.push('is-menu');
    for (const keep of ['is-dragging', 'is-drop-before', 'is-drop-after', 'is-flash']) {
      if (el.classList.contains(keep)) cls.push(keep);
    }
    const name = cls.join(' ');
    if (el.className !== name) el.className = name;
    el.querySelector('.cb').setAttribute('aria-pressed', v.done ? 'true' : 'false');
    el.querySelector('.t').textContent = v.title;
    let sub = v.sub || v.ref || '';
    if (mode === 'done') sub = (v.doneAt ? v.doneAt + ' 완료' : '완료') + (v.sub ? ' · ' + v.sub : '');
    el.querySelector('.st').textContent = sub;
    el.querySelector('.body').title = v.title + (v.sub ? ' — ' + v.sub : '') + (v.ref ? '\n← ' + v.ref : '');
    const ic = el.querySelector('.ic');
    if (ic.dataset.cat !== v.cat) {
      ic.dataset.cat = v.cat;
      ic.innerHTML = svg(CAT_ICON[v.cat] || CAT_ICON.etc, 13, 2);
    }
    const chip = el.querySelector('.chip');
    const dd = mode === 'focus' ? ddayOf(v) : null;
    chip.hidden = !dd;
    if (dd) {
      chip.textContent = dd.text;
      chip.classList.toggle('is-late', dd.n < 0);
    }
    const isMenu = menuKey === v.key;
    el.querySelector('.bar').hidden = !isMenu;
    el.querySelector('.more').setAttribute('aria-expanded', isMenu ? 'true' : 'false');
  }

  function place(box, list, mode, live) {
    list.forEach((v, i) => {
      live.add(v.key);
      let el = nodes.get(v.key);
      if (!el) {
        el = make();
        nodes.set(v.key, el);
      }
      fill(el, v, mode);
      const at = box.children[i];
      if (at !== el) box.insertBefore(el, at || null);
    });
  }

  const emptyEl = document.createElement('div');
  emptyEl.className = 'empty';

  function render(s) {
    current = s;
    emptyEl.remove();
    if (!s || !s.ok) {
      for (const el of nodes.values()) el.remove();
      nodes.clear();
      $('counts').textContent = '파일을 못 읽었어요';
      $('pillTitle').textContent = 'STATUS.md를 못 읽었어요';
      $('pillDday').textContent = '';
      $('pillCount').textContent = '!';
      emptyEl.textContent = (s && s.error) || 'STATUS.md를 읽지 못했어요';
      $('focus').appendChild(emptyEl);
      return;
    }
    $('counts').textContent = '할 일 ' + s.todo.length + ' · 보류 ' + s.hold.length + ' · 완료 ' + s.done.length;
    $('holdCount').textContent = '보류 ' + s.hold.length;
    $('doneCount').textContent = '완료 ' + s.done.length;

    let best = null;
    for (const v of s.todo) {
      if (v.done) continue;
      const dd = ddayOf(v);
      if (dd && (!best || dd.n < best.dd.n)) best = { dd, v };
    }
    const dday = $('dday');
    dday.hidden = !best;
    if (best) {
      dday.textContent = best.dd.text;
      dday.title = '가장 가까운 마감: ' + best.v.title;
      dday.classList.toggle('is-late', best.dd.n < 0);
    }
    const openTodo = s.todo.filter(v => !v.done);
    const lead = best ? best.v : openTodo[0];
    $('pillDday').textContent = best ? best.dd.text : '';
    $('pillTitle').textContent = lead ? lead.title : '할 일 없음';
    $('pillCount').textContent = String(openTodo.length);
    $('pillBtn').setAttribute('aria-label', '현황판 펼치기' + (lead ? ': ' + (best ? best.dd.text + ' ' : '') + lead.title : '') + ', 할 일 ' + openTodo.length + '개');

    const checked = s.todo.filter(v => v.done).length + s.hold.filter(v => v.done).length;
    $('clean').hidden = !checked;
    $('cleanBadge').textContent = String(checked);
    $('undo').classList.toggle('is-off', !s.canUndo);

    const live = new Set();
    place($('focus'), s.todo.slice(0, 3), 'focus', live);
    place($('rest'), s.todo.slice(3), 'row', live);
    place($('held'), s.hold, 'held', live);
    place($('doneList'), s.done, 'done', live);
    for (const [k, el] of nodes) {
      if (!live.has(k)) {
        el.remove();
        nodes.delete(k);
      }
    }
    if (menuKey && !live.has(menuKey)) menuKey = null;
    if (!s.todo.length) {
      emptyEl.textContent = '할 일이 없어요';
      $('focus').appendChild(emptyEl);
    }

    $('footText').textContent = (s.name || 'STATUS.md') + ' · ' + (note || '저장 ' + hhmm(s.mtime));

    if (flashKey) {
      const el = nodes.get(flashKey);
      flashKey = null;
      if (el) {
        el.classList.remove('is-flash');
        void el.offsetWidth;
        el.classList.add('is-flash');
        setTimeout(() => el.classList.remove('is-flash'), 750);
      }
    }
  }

  async function apply(op, flash) {
    const s = await api.apply(op);
    if (flash) flashKey = flash;
    note = '';
    render(s);
    if (s.error) toast(s.error);
    return s;
  }

  async function act(op, el) {
    if (busy) return;
    busy = true;
    const key = el.dataset.key;
    try {
      if (op === 'toggle') {
        el.classList.toggle('is-done');
        await apply({ type: 'toggle', key });
      } else if (op === 'complete' || op === 'purge') {
        menuKey = null;
        el.classList.add('is-leaving');
        await wait(280);
        await apply({ type: op, key });
      } else {
        menuKey = null;
        await apply({ type: op, key }, key);
      }
    } catch (e) {
      el.classList.remove('is-leaving');
      toast('저장하지 못했어요: ' + (e && e.message ? e.message : e));
    } finally {
      busy = false;
    }
  }

  function toggleMenu(el, forceOpen) {
    const key = el.dataset.key;
    menuKey = forceOpen ? key : menuKey === key ? null : key;
    if (current) render(current);
  }

  function closeMenu() {
    if (!menuKey) return;
    menuKey = null;
    if (current) render(current);
  }

  document.addEventListener('click', e => {
    if (menuKey && !e.target.closest('.it')) closeMenu();
  });

  // ── 끌어서 옮기기 ──
  function setOver(next) {
    if (over && next && over.el === next.el && over.after === next.after && over.zone === next.zone) return;
    if (over && over.el) over.el.classList.remove('is-drop-before', 'is-drop-after', 'is-target');
    over = next;
    if (!over || !over.el) return;
    if (over.zone) over.el.classList.add('is-target');
    else over.el.classList.add(over.after ? 'is-drop-after' : 'is-drop-before');
  }

  function endDrag() {
    for (const el of nodes.values()) el.classList.remove('is-dragging');
    setOver(null);
    dragKey = null;
  }

  async function dropNow() {
    const key = dragKey;
    const target = over;
    endDrag();
    if (!key || !target || busy) return;
    busy = true;
    try {
      if (target.zone) await apply({ type: 'move', key, zone: target.zone }, target.zone === 'done' ? null : key);
      else await apply({ type: 'move', key, target: target.key, after: target.after }, key);
    } finally {
      busy = false;
    }
  }

  for (const id of ['holdFold', 'doneFold']) {
    const fold = $(id);
    fold.addEventListener('dragover', e => {
      if (!dragKey) return;
      e.preventDefault();
      setOver({ el: fold, zone: fold.dataset.zone });
    });
    fold.addEventListener('drop', e => {
      e.preventDefault();
      dropNow();
    });
  }

  // ── 머리 버튼 ──
  $('undo').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      note = '';
      menuKey = null;
      render(await api.undo());
    } finally {
      busy = false;
    }
  });
  $('clean').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      for (const el of nodes.values()) {
        if (el.classList.contains('is-done') && !el.classList.contains('is-donearea')) el.classList.add('is-leaving');
      }
      await wait(300);
      await apply({ type: 'cleanup' });
      setFold('doneFold', 'doneList', true);
    } finally {
      busy = false;
    }
  });
  function setStayUi(on) {
    // 트레이의 "펼친 채로 두기"(영구): 켜면 고정해서 시작한다
    stay = !!on;
    if (stay) setPinned(true);
  }
  $('pinBtn').addEventListener('click', () => {
    if (!pinned) {
      setPinned(true);
      return;
    }
    setPinned(false);
    suppressHover = true;
    setOpen(false);
  });
  $('info').addEventListener('click', () => {
    const p = $('infoPop');
    p.hidden = !p.hidden;
    $('info').classList.toggle('is-on', !p.hidden);
    $('info').setAttribute('aria-expanded', p.hidden ? 'false' : 'true');
  });
  $('file').addEventListener('click', () => api.openFile());

  function setFold(btnId, listId, on) {
    $(listId).hidden = !on;
    $(btnId).setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  $('holdFold').addEventListener('click', () => setFold('holdFold', 'held', $('held').hidden));
  $('doneFold').addEventListener('click', () => setFold('doneFold', 'doneList', $('doneList').hidden));

  // ── 할 일 추가 ──
  function renderTags() {
    const box = $('tags');
    box.innerHTML = '';
    for (const c of CATS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tag' + (c.key === addCat ? ' is-on' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', c.key === addCat ? 'true' : 'false');
      b.title = c.name;
      b.innerHTML = svg(CAT_ICON[c.key], 13, 2) + '<span class="nm"></span>';
      b.querySelector('.nm').textContent = c.name;
      b.addEventListener('click', () => {
        addCat = c.key;
        renderTags();
        $('addInput').focus();
      });
      box.appendChild(b);
    }
  }

  function setAdding(on) {
    $('addBox').hidden = !on;
    $('add').classList.toggle('is-on', on);
    $('add').setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) {
      renderTags();
      $('addInput').value = '';
      setTimeout(() => $('addInput').focus(), 30);
    }
  }

  async function submitAdd() {
    const text = $('addInput').value.trim();
    if (!text || busy) return;
    busy = true;
    try {
      const s = await apply({ type: 'add', text, cat: addCat });
      if (s.ok && s.todo[3]) {
        flashKey = s.todo[3].key;
        render(s);
      } else if (s.ok && s.todo.length) {
        flashKey = s.todo[s.todo.length - 1].key;
        render(s);
      }
      setAdding(false);
    } finally {
      busy = false;
    }
  }

  $('add').addEventListener('click', () => setAdding($('addBox').hidden));
  $('addGo').addEventListener('click', submitAdd);
  $('addInput').addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAdd();
    } else if (e.key === 'Escape') {
      setAdding(false);
    }
  });

  // ── 시작 ──
  async function load() {
    render(await api.get());
  }

  api.onChanged(s => {
    note = '새로 불러옴 ' + hhmm();
    render(s);
    const dot = document.querySelector('.dot');
    dot.classList.add('is-new');
    clearTimeout(newTimer);
    newTimer = setTimeout(() => {
      dot.classList.remove('is-new');
      note = '';
      if (current) render(current);
    }, 8000);
  });
  api.onStay(setStayUi);
  api.onOpen(() => {
    // 트레이·바로가기로 펼쳤을 때 커서가 안 오면 잠시 뒤 다시 접는다
    setOpen(true);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!hovering && canAutoClose()) setOpen(false);
    }, 5000);
  });
  api.onWall(setWall);
  api.onBounds(b => {
    winBounds = b.bounds;
    if (wallInfo && b.layer) wallInfo.layer = b.layer;
    placeWall();
  });
  api.winState().then(st => {
    setStayUi(st.stay);
    if (st.startOpen) setOpen(true);
  });
  api.getWall().then(w => { if (w && w.wall) setWall(w); });
  setInterval(() => { if (current) render(current); }, 10 * 60 * 1000); // 날짜가 바뀌면 D-day 갱신

  // 시험 스크립트용
  window.__widget = { open: () => setOpen(true), close: () => setOpen(false), state: () => ({ open, pinned, stay, ignoring, menuKey, suppressHover }) };
  load();
})();
