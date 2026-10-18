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
  let tab = 'todo'; // 할 일 | 프로젝트
  const projOpen = new Map(); // 프로젝트 이름 → 펼쳤는지
  const projDoneOpen = new Map(); // 프로젝트 이름 → 끝난 단계 보이는지
  let addDate = null; // 추가할 때 고른 날짜 (Date)
  let addKind = 'ask'; // ask = Claude가 물어보기, notify = 알림만
  let calView = null; // 달력에 보이는 달 (그달 1일)
  let shownNotice = ''; // 지금 떠 있는 알림 (새로 뜰 때만 움직임을 준다)

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

  function todayDate() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function ddayOf(v) {
    if (!v.due) return null;
    const today = todayDate();
    let at = new Date(today.getFullYear(), v.due.m - 1, v.due.d);
    if (at - today < -60 * DAY) at = new Date(today.getFullYear() + 1, v.due.m - 1, v.due.d);
    const n = Math.round((at - today) / DAY);
    return { n, at, text: n > 0 ? 'D-' + n : n === 0 ? 'D-day' : 'D+' + -n };
  }

  const WEEK = '일월화수목금토';
  const md = d => (d.getMonth() + 1) + '/' + d.getDate();
  const dayLabel = d => md(d) + ' ' + WEEK.charAt(d.getDay());
  const dayKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  // 받침이 있으면 "이", 없으면 "가" (한글이 아니면 "이(가)")
  function josa(word) {
    const c = String(word).trim().slice(-1).charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? '이' : '가';
    return '이(가)';
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
    for (const host of document.querySelectorAll('.host')) {
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
    return !pinned && !dragKey && !resizing && !moving && $('addBox').hidden && $('tonePop').hidden;
  }

  // ── 판 가장자리를 끌어서 높이 조절 (아래로 펼치면 아래 가장자리, 위로 펼치면 위 가장자리) ──
  let panelH = 652;
  let resizing = false;
  let moving = false; // 위젯을 끌어서 옮기는 중
  function setPanelH(h) {
    panelH = Math.round(h);
    body.style.setProperty('--panel-h', panelH + 'px');
    body.style.setProperty('--panel-sy', (48 / panelH).toFixed(4));
  }
  $('sizeGrip').addEventListener('pointerdown', e => {
    if (e.button !== 0 || resizing) return;
    e.preventDefault();
    const grip = $('sizeGrip');
    try { grip.setPointerCapture(e.pointerId); } catch (err) {}
    resizing = true;
    body.classList.add('is-resizing');
    setIgnore(false);
    const startY = e.screenY;
    const startH = panelH;
    const dir = body.classList.contains('anchor-up') ? -1 : 1; // 위로 펼친 판은 위로 끌어야 길어진다
    let lim = { min: 420, max: startH };
    let want = startH;
    const move = ev => {
      want = startH + dir * (ev.screenY - startY);
      setPanelH(Math.min(Math.max(want, lim.min), lim.max));
    };
    const ready = api.resizeBegin().then(r => {
      if (r) lim = r;
      setPanelH(Math.min(Math.max(want, lim.min), lim.max));
    });
    const end = async () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      await ready;
      setPanelH(await api.resizeEnd(panelH));
      resizing = false;
      body.classList.remove('is-resizing');
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  });

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
    if (resizing || moving) return; // 끄는 동안은 커서가 판 밖으로 나가도 클릭 통과로 바꾸지 않는다
    if (ignoreRealPointer && e.isTrusted) return; // 시험 중: 책상 위 진짜 마우스가 끼어들지 않게
    const host = e.target.closest ? e.target.closest('.host') : null;
    const active = open ? $('panel') : $('pill');
    const inside = host === active;
    // 접혀 있을 때 알약 밑 알림 위에서는 클릭을 받되 판은 펼치지 않는다
    const onNotice = !open && !!host && host.classList.contains('notice') && !host.hidden;
    // 알약의 핀 위에서는 판을 펼치지 않는다 (펼치면 판에 가려 핀을 못 누른다)
    const onPin = !open && !!e.target.closest && !!e.target.closest('#pillPin');
    hovering = inside;
    setIgnore(!inside && !onNotice);
    if (!inside && !open) suppressHover = false;
    if (inside) {
      clearTimeout(closeTimer);
      if (onPin) {
        clearTimeout(openTimer);
        openTimer = null;
      } else if (!open && !openTimer && !suppressHover && !press && !(e.buttons & 1)) {
        // 누르고 있는 동안(끌기 직전 멈칫할 때 포함)에는 판을 펼치지 않는다
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

  // ── 맨 위 고정 (알약 오른쪽 핀): 트레이의 "항상 위에 두기"와 같은 설정이고 다음에 켤 때도 기억한다 ──
  let onTop = false;
  function setTopUi(on) {
    onTop = !!on;
    body.classList.toggle('is-ontop', onTop);
    const b = $('pillPin');
    b.setAttribute('aria-pressed', onTop ? 'true' : 'false');
    b.title = onTop ? '맨 위 고정 켜짐 — 누르면 해제' : '맨 위 고정 — 다른 창보다 늘 위';
  }
  $('pillPin').addEventListener('click', async e => {
    e.stopPropagation();
    setTopUi(await api.setPinned(!onTop));
  });
  api.onPinned(setTopUi);

  const inPill = (x, y) => {
    const p = $('pill');
    return x >= p.offsetLeft && x <= p.offsetLeft + p.offsetWidth && y >= p.offsetTop && y <= p.offsetTop + p.offsetHeight;
  };

  // ── 아무 데나 끌어서 옮기기 ──
  // 접힌 알약, 또는 펼친 판의 빈 곳(줄·버튼·입력칸이 아닌 곳)을 누른 채 5px 넘게 움직이면 위젯을 옮긴다.
  // 알약에 커서를 올려 판이 펼쳐진 직후 알약 자리를 끌면, 판을 접고 알약만 따라오게 한다.
  const NOT_DRAG = 'button, input, textarea, select, a, [role="button"], [role="tab"], .it, .pj, .step, .addBox, .tonePop, .note, .cal, .tabs, .prog, .fold, .sizeGrip, .notice, .toast, .pjHidden';
  let press = null;
  let ignoreRealPointer = false; // 시험 스크립트만 켠다 (window.__widget.ignoreRealPointer)
  let blockClickUntil = 0;
  let moveFrame = 0;
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || moving || resizing) return;
    const t = e.target;
    let fromPill = false;
    if (!open && t.closest('#pill') && !t.closest('#pillPin')) {
      fromPill = true;
      clearTimeout(openTimer);
      openTimer = null;
    } else if (open && !pinned && inPill(e.clientX, e.clientY) && !t.closest('.sizeGrip, .tonePop, input')) {
      // 커서를 올려 판이 잠깐 펼쳐진 동안, 알약이 있던 자리에서 시작한 끌기는 언제든 알약 옮기기다.
      // (그 자리에 깔린 할 일 줄·바닥 버튼이 대신 끌리거나 눌리지 않게. 끌지 않고 누르기만 하면 원래대로)
      fromPill = true;
    } else if (!open || !t.closest('#panel') || t.closest(NOT_DRAG)) {
      return;
    }
    press = { x: e.screenX, y: e.screenY, id: e.pointerId, target: t, fromPill, started: false };
  }, true);
  document.addEventListener('pointermove', e => {
    if (!press) return;
    if (ignoreRealPointer && e.isTrusted) return; // 시험 중: 책상 위 진짜 마우스가 끼어들지 않게
    if (!(e.buttons & 1)) {
      // 창 밖에서 버튼을 놓아 pointerup을 못 받은 경우: 누른 채가 아니면 끌기를 끝낸다 (위젯이 커서를 따라다니지 않게)
      endPress();
      return;
    }
    if (!press.started) {
      if (Math.abs(e.screenX - press.x) + Math.abs(e.screenY - press.y) < 5) return;
      press.started = true;
      moving = true;
      body.classList.add('is-moving');
      try { press.target.setPointerCapture(press.id); } catch (err) {}
      closeMenu();
      if (press.fromPill && open) {
        suppressHover = true;
        setOpen(false); // 판을 접고 알약만 옮긴다
      }
      setIgnore(false);
      api.dragStart({ x: press.x, y: press.y });
    }
    press.last = { x: e.screenX, y: e.screenY };
    if (!moveFrame) {
      moveFrame = requestAnimationFrame(() => {
        moveFrame = 0;
        if (press && press.last) api.dragMove(press.last);
      });
    }
  }, true);
  const endPress = async () => {
    const p = press;
    press = null;
    if (!p || !p.started) return;
    blockClickUntil = Date.now() + 400; // 끌고 놓은 뒤 따라오는 클릭은 무시 (알약 고정 등이 눌리지 않게)
    if (p.fromPill) suppressHover = true;
    if (p.last) api.dragMove(p.last); // 마지막 자리까지 옮긴 뒤 붙을 쪽을 정한다
    let r = null;
    try {
      r = await api.dragEnd();
    } catch (err) {}
    moving = false;
    body.classList.remove('is-moving');
    if (r) applyAnchor(r);
  };
  document.addEventListener('pointerup', endPress, true);
  document.addEventListener('pointercancel', endPress, true);
  document.addEventListener('click', e => {
    if (Date.now() < blockClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      blockClickUntil = 0;
    }
  }, true);

  // 화면 가장자리 쪽 붙기를 화면에 반영한다 (자리가 바뀌는 순간은 잠깐 숨겨 튀어 보이지 않게)
  let anchorKey = 'right down';
  function applyAnchor(r) {
    if (!r || !r.anchor) return;
    const key = r.anchor.h + ' ' + r.anchor.v;
    const changed = key !== anchorKey;
    if (changed) body.classList.add('is-reanchor');
    anchorKey = key;
    body.classList.toggle('anchor-left', r.anchor.h === 'left');
    body.classList.toggle('anchor-up', r.anchor.v === 'up');
    if (r.panelH) setPanelH(r.panelH);
    if (noticeNow && noticeNow.type === 'ask') layoutBubble();
    placeWall();
    if (changed) setTimeout(() => body.classList.remove('is-reanchor'), 120);
  }
  api.onAnchor(applyAnchor);

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
      if (press && press.fromPill) {
        e.preventDefault(); // 알약 자리에서 시작한 끌기는 줄 순서 바꾸기가 아니라 위젯 옮기기
        return;
      }
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

  const PEN = '<path d="M4 20l4.2-1 10.3-10.3a2.1 2.1 0 0 0-3-3L5.2 16 4 20z"/><path d="M13.5 7.5l3 3"/>';

  function fill(el, v, mode) {
    el.dataset.key = v.key;
    const cls = ['it', mode === 'focus' ? 'card' : 'row', 'cat-' + v.cat];
    if (v.user) cls.push('is-user');
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
    const dd0 = v.user ? ddayOf(v) : null;
    // 직접 넣은 줄: "직접 추가 · 10/31 토" (적어 둔 설명이 있으면 그것 · 날짜)
    if (v.user) sub = (v.note || '직접 추가') + (dd0 ? ' · ' + dayLabel(dd0.at) : '');
    if (mode === 'done') sub = (v.doneAt ? v.doneAt + ' 완료' : '완료') + (v.sub ? ' · ' + v.sub : '');
    el.querySelector('.st').textContent = sub;
    el.querySelector('.body').title = v.title + (v.sub ? ' — ' + v.sub : '') + (v.ref ? '\n← ' + v.ref : '');
    const ic = el.querySelector('.ic');
    const icKey = v.user && mode !== 'done' ? 'user' : v.cat;
    if (ic.dataset.cat !== icKey) {
      ic.dataset.cat = icKey;
      ic.innerHTML = svg(icKey === 'user' ? PEN : CAT_ICON[v.cat] || CAT_ICON.etc, icKey === 'user' ? 11 : 13, icKey === 'user' ? 2.2 : 2);
    }
    const chip = el.querySelector('.chip');
    const dd = mode === 'focus' || (v.user && mode === 'row') ? ddayOf(v) : null;
    chip.hidden = !dd || v.done;
    if (dd) {
      chip.textContent = v.user && dd.n === 0 ? '오늘' : dd.text;
      chip.classList.toggle('is-late', dd.n < 0);
      chip.classList.toggle('is-soft', !!v.user);
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
    mqStopAll(); // 글을 새로 채우기 전에 흐르던 전광판을 원래 글로 되돌린다
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
      $('prog').hidden = true;
      $('tabs').hidden = true;
      $('pillProg').hidden = true;
      $('pill').classList.remove('has-prog');
      showNotice(null);
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

    renderProjects(s);
    renderNotices(s);

    $('footText').textContent = (s.name || 'STATUS.md') + ' · ' + (note || '저장 ' + hhmm(s.mtime));

    mqRefresh();

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

  // ── 프로젝트: 맨 위 진행 줄 · 탭 · 카드 ──
  function stepInfo(v) {
    const steps = v.steps || [];
    const done = steps.filter(x => x.state === 'done').length;
    const nowIdx = steps.findIndex(x => x.state === 'now');
    let nextIdx = -1;
    for (let k = nowIdx >= 0 ? nowIdx + 1 : 0; k < steps.length; k++) {
      if (steps[k].state === 'todo') { nextIdx = k; break; }
    }
    const pct = steps.length ? Math.round(done / steps.length * 100) : 0;
    return { steps, done, total: steps.length, nowIdx, nextIdx, pct };
  }

  function setTab(t, save) {
    tab = t === 'proj' ? 'proj' : 'todo';
    const proj = tab === 'proj';
    body.classList.toggle('tab-proj', proj);
    $('tabTodo').classList.toggle('is-on', !proj);
    $('tabProj').classList.toggle('is-on', proj);
    $('tabTodo').setAttribute('aria-selected', proj ? 'false' : 'true');
    $('tabProj').setAttribute('aria-selected', proj ? 'true' : 'false');
    $('todoPane').hidden = proj;
    $('projPane').hidden = !proj;
    if (proj) closeMenu();
    if (save) store.set('tab', tab);
  }

  const LIFT = '<path d="M6 4.5h12"/><path d="M12 20V9"/><path d="M7.5 13.5L12 9l4.5 4.5"/>';
  const TRASH = '<path d="M5 7h14"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7"/><path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7"/>';
  const EYE_OFF = '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6-.4.7-1.3 1.9-2.6 3.1"/><path d="M6.6 7.6C4.6 8.9 3.1 10.8 2.5 12c1 1.5 4.5 6 9.5 6 1.6 0 3-.4 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';
  // 끝난 프로젝트는 위젯에서만 지운다 (파일은 그대로). 다시 단계가 생기면 저절로 다시 보인다
  // (store는 아래 유리 색 부분에서 만들어지므로 처음 쓸 때 읽는다)
  let hiddenSet = null;
  function hiddenProj() {
    if (!hiddenSet) {
      try { hiddenSet = new Set(JSON.parse(store.get('hidden-proj') || '[]') || []); } catch (e) { hiddenSet = new Set(); }
    }
    return hiddenSet;
  }
  const saveHidden = () => store.set('hidden-proj', JSON.stringify([...hiddenProj()]));
  const finishedProj = v => !!v.done || ((v.steps || []).length > 0 && v.steps.every(x => x.state === 'done'));
  const CHEV = '<path d="M8 10l4 4 4-4"/>';
  const CHECK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
  const PJ_TEMPLATE =
    '<div class="pjHead" role="button" tabindex="0" aria-expanded="false">' +
    '<div class="pjRow"><span class="pjT"></span><span class="chip" hidden></span>' +
    '<button class="ib sm pjLift" type="button" aria-label="맨 위로" title="맨 위로 — 알약과 맨 위 줄에 띄우기">' + svg(LIFT, 15, 2) + '</button>' +
    '<button class="ib sm pjHide" type="button" aria-label="위젯에서 지우기" title="위젯에서 지우기 (파일은 그대로)">' + svg(TRASH, 15, 2) + '</button>' +
    '<span class="pjPct"></span><span class="chev">' + svg(CHEV, 16, 2) + '</span></div>' +
    '<div class="pjSub pjDesc"><span class="tx"></span></div>' +
    '<span class="track"><span class="fill"></span></span>' +
    '<div class="pjSub pjNow"><span class="dot2" aria-hidden="true"></span><span class="key"></span><span class="tx"></span></div>' +
    '</div>' +
    '<div class="pjSteps" hidden>' +
    '<button class="dfold" type="button" aria-expanded="false">' + svg(CHECK, 14, 2.2) + '<span class="grow"></span><span class="chev">' + svg(CHEV, 15, 2) + '</span></button>' +
    '<div class="stepList"></div>' +
    '</div>';
  const pjNodes = new Map();

  function makeProj() {
    const el = document.createElement('div');
    el.className = 'pj';
    el.innerHTML = PJ_TEMPLATE;
    const head = el.querySelector('.pjHead');
    const toggle = () => {
      const name = el.dataset.name;
      projOpen.set(name, !el.classList.contains('is-open'));
      if (current) render(current);
    };
    head.addEventListener('click', e => {
      if (e.target.closest('.pjLift')) return;
      toggle();
    });
    head.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
    el.querySelector('.pjLift').addEventListener('click', async e => {
      e.stopPropagation();
      if (busy) return;
      busy = true;
      try {
        await apply({ type: 'top', key: el.dataset.key });
        const fresh = pjNodes.get(current && current.proj && current.proj[0] ? current.proj[0].key : '');
        if (fresh) {
          fresh.classList.remove('is-flash');
          void fresh.offsetWidth;
          fresh.classList.add('is-flash');
          setTimeout(() => fresh.classList.remove('is-flash'), 750);
        }
      } finally {
        busy = false;
      }
    });
    el.querySelector('.pjHide').addEventListener('click', e => {
      e.stopPropagation();
      hiddenProj().add(el.dataset.name);
      saveHidden();
      el.classList.add('is-leaving');
      setTimeout(() => { if (current) render(current); }, 300);
    });
    el.querySelector('.dfold').addEventListener('click', () => {
      const name = el.dataset.name;
      projDoneOpen.set(name, !projDoneOpen.get(name));
      if (current) render(current);
    });
    el.querySelector('.stepList').addEventListener('click', async e => {
      const cb = e.target.closest('.cb');
      if (!cb || busy) return;
      const row = cb.closest('.step');
      busy = true;
      try {
        row.classList.toggle('is-done');
        await apply({ type: 'step', key: el.dataset.key, idx: Number(row.dataset.idx) });
      } catch (err) {
        toast('저장하지 못했어요: ' + (err && err.message ? err.message : err));
      } finally {
        busy = false;
      }
    });
    return el;
  }

  function fillProj(el, v, i) {
    const inf = stepInfo(v);
    if (!projOpen.has(v.title)) projOpen.set(v.title, i === 0);
    const isOpen = projOpen.get(v.title);
    const doneOpen = !!projDoneOpen.get(v.title);
    el.dataset.key = v.key;
    el.dataset.name = v.title;
    el.classList.toggle('is-open', isOpen);
    el.querySelector('.pjHead').setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    el.querySelector('.pjT').textContent = v.title;
    el.querySelector('.pjHead').title = v.title + (v.sub ? ' — ' + v.sub : '');
    const chip = el.querySelector('.chip');
    const dd = ddayOf(v);
    chip.hidden = !dd;
    if (dd) {
      chip.textContent = dd.text;
      chip.classList.toggle('is-late', dd.n < 0);
    }
    el.querySelector('.pjLift').hidden = i === 0;
    el.querySelector('.pjHide').hidden = !finishedProj(v);
    el.classList.remove('is-leaving');
    el.querySelector('.pjPct').textContent = inf.pct + '%';
    el.querySelector('.fill').style.width = inf.pct + '%';
    const desc = el.querySelector('.pjDesc');
    desc.hidden = !isOpen || !v.sub;
    desc.querySelector('.tx').textContent = v.sub || '';
    // 접혀 있으면 "지금 · 하는 단계" (없으면 다음 단계) 한 줄
    const now = el.querySelector('.pjNow');
    const pick = inf.nowIdx >= 0 ? inf.nowIdx : inf.nextIdx;
    now.hidden = isOpen || (pick < 0 && !(inf.total && inf.done === inf.total));
    now.querySelector('.dot2').className = 'dot2 ' + (inf.nowIdx >= 0 ? 'nowdot' : 'nextdot');
    now.querySelector('.key').textContent = inf.nowIdx >= 0 ? '지금' : pick >= 0 ? '다음' : '';
    now.querySelector('.tx').textContent = pick >= 0 ? inf.steps[pick].text : '다 끝났어요';
    // 펼치면 단계 목록: 끝난 것은 접어 두고 "끝난 N"으로
    const stepsBox = el.querySelector('.pjSteps');
    stepsBox.hidden = !isOpen;
    const dfold = el.querySelector('.dfold');
    dfold.hidden = !inf.done;
    dfold.setAttribute('aria-expanded', doneOpen ? 'true' : 'false');
    dfold.querySelector('.grow').textContent = '끝난 ' + inf.done;
    const list = el.querySelector('.stepList');
    while (list.children.length > inf.total) list.lastChild.remove();
    while (list.children.length < inf.total) {
      const row = document.createElement('div');
      row.className = 'step';
      row.innerHTML = '<button class="cb" type="button" aria-label="끝났으면 체크" aria-pressed="false">' + svg(CHECK, 12, 3.2) + '</button>' +
        '<span class="stT"><span class="t"></span></span><span class="stTag" hidden></span>';
      list.appendChild(row);
    }
    inf.steps.forEach((s, k) => {
      const row = list.children[k];
      row.dataset.idx = String(k);
      const name = 'step' + (s.state === 'done' ? ' is-done' : '') + (s.state === 'now' ? ' is-now' : '');
      if (row.className !== name) row.className = name;
      row.hidden = s.state === 'done' && !doneOpen;
      row.querySelector('.cb').setAttribute('aria-pressed', s.state === 'done' ? 'true' : 'false');
      row.querySelector('.t').textContent = s.text;
      const tag = row.querySelector('.stTag');
      const isNext = k === inf.nextIdx;
      tag.hidden = !(s.state === 'now' || isNext);
      tag.className = 'stTag ' + (s.state === 'now' ? 'is-now' : 'is-next');
      tag.textContent = s.state === 'now' ? '지금' : '다음';
    });
  }

  // 숨긴(지운) 끝난 프로젝트: 맨 아래 접기 칸에서 다시 보이게 할 수 있다
  const hidFold = document.createElement('div');
  hidFold.className = 'pjHidden';
  hidFold.innerHTML = '<button class="fold" type="button" aria-expanded="false">' + svg(EYE_OFF, 15, 2) +
    '<span class="grow"></span><span class="chev">' + svg(CHEV, 16, 2) + '</span></button><div class="pjHidList" hidden></div>';
  hidFold.querySelector('.fold').addEventListener('click', () => {
    const list = hidFold.querySelector('.pjHidList');
    list.hidden = !list.hidden;
    hidFold.querySelector('.fold').setAttribute('aria-expanded', list.hidden ? 'false' : 'true');
  });
  const projEmpty = document.createElement('div');
  projEmpty.className = 'empty';
  projEmpty.textContent = '진행 중인 프로젝트가 없어요';

  function renderProjects(s) {
    const all = s.proj || [];
    // 다시 단계가 생겨 안 끝난 상태가 되면 숨김을 푼다
    let changed = false;
    for (const name of [...hiddenProj()]) {
      const v = all.find(p => p.title === name);
      if (v && !finishedProj(v)) {
        hiddenProj().delete(name);
        changed = true;
      }
    }
    if (changed) saveHidden();
    const isHidden = v => hiddenProj().has(v.title) && finishedProj(v);
    const projs = all.filter(v => !isHidden(v));
    const hid = all.filter(isHidden);
    const has = all.length > 0;
    $('tabs').hidden = !has;
    if (!has && tab === 'proj') setTab('todo');
    $('tabTodoCount').textContent = String(s.todo.filter(v => !v.done).length);
    $('tabProjCount').textContent = String(projs.length);
    const live = new Set();
    const box = $('projPane');
    projEmpty.remove();
    projs.forEach((v, i) => {
      live.add(v.key);
      let el = pjNodes.get(v.key);
      if (!el) {
        el = makeProj();
        pjNodes.set(v.key, el);
      }
      fillProj(el, v, i);
      const at = box.children[i];
      if (at !== el) box.insertBefore(el, at || null);
    });
    for (const [k, el] of pjNodes) {
      if (!live.has(k)) {
        el.remove();
        pjNodes.delete(k);
      }
    }
    if (!projs.length && has) box.appendChild(projEmpty);
    if (hid.length) {
      hidFold.querySelector('.grow').textContent = '지운 프로젝트 ' + hid.length;
      const list = hidFold.querySelector('.pjHidList');
      list.textContent = '';
      for (const v of hid) {
        const row = document.createElement('div');
        row.className = 'pjHidRow';
        const t = document.createElement('span');
        t.className = 'tx';
        t.textContent = v.title;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'nb';
        b.textContent = '다시 보이기';
        b.addEventListener('click', () => {
          hiddenProj().delete(v.title);
          saveHidden();
          if (current) render(current);
        });
        row.append(t, b);
        list.appendChild(row);
      }
      box.appendChild(hidFold);
    } else {
      hidFold.remove();
    }
    // 맨 위 줄과 알약: 끝나지 않은 맨 위 프로젝트
    const top = projs.find(v => !v.done && (v.steps || []).length);
    $('prog').hidden = !top;
    $('pillProg').hidden = !top;
    $('pill').classList.toggle('has-prog', !!top);
    if (!top) return;
    const inf = stepInfo(top);
    $('progName').textContent = top.title;
    $('progNow').textContent = inf.nowIdx >= 0 ? '· ' + inf.steps[inf.nowIdx].text : inf.nextIdx >= 0 ? '· 다음 ' + inf.steps[inf.nextIdx].text : '· 다 끝났어요';
    $('progPct').textContent = inf.pct + '%';
    $('progFill').style.width = inf.pct + '%';
    $('prog').dataset.name = top.title;
    $('pillFill').style.width = inf.pct + '%';
    $('pillPct').textContent = inf.pct + '%';
    $('pillProg').title = top.title + ' ' + inf.pct + '%';
    const label = $('pillBtn').getAttribute('aria-label') || '';
    if (!/ 진행 /.test(label)) $('pillBtn').setAttribute('aria-label', label + ', ' + top.title + ' 진행 ' + inf.pct + '%');
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

  // ── 유리 색 (오른쪽 아래 톱니) ──
  const TONES = ['smoke', 'milk', 'ice', 'lavender'];
  const CUSTOM_VARS = ['--tint', '--rim-tint', '--bright', '--rim-bright'];
  const store = {
    get: k => { try { return localStorage.getItem('status-widget-' + k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem('status-widget-' + k, v); } catch (e) {} }
  };

  function markTone(t) {
    for (const sw of document.querySelectorAll('#tonePop .sw')) {
      sw.setAttribute('aria-checked', sw.dataset.tone === t ? 'true' : 'false');
    }
  }

  function setTone(tone, save) {
    const t = TONES.includes(tone) ? tone : 'smoke';
    for (const v of CUSTOM_VARS) body.style.removeProperty(v);
    body.dataset.tone = t;
    markTone(t);
    $('customRow').hidden = true;
    if (save) store.set('tone', t);
  }

  function parseHex(text) {
    let h = String(text || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return { hex: '#' + h.toLowerCase(), r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  // 직접 고른 색: 밝은 색이면 진한 글자(밀크 계열), 어두운 색이면 흰 글자(스모크 계열)
  function setCustom(text, save) {
    const c = parseHex(text);
    if (!c) return false;
    const light = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 > 0.58;
    body.dataset.tone = light ? 'custom-light' : 'custom-dark';
    body.style.setProperty('--tint', 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (light ? 0.6 : 0.52) + ')');
    body.style.setProperty('--rim-tint', 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',.3)');
    body.style.setProperty('--bright', light ? '1.22' : '.75');
    body.style.setProperty('--rim-bright', light ? '1.15' : '.85');
    $('swCustom').style.background = c.hex;
    $('colorIn').value = c.hex;
    $('hexIn').value = c.hex;
    $('hexIn').classList.remove('is-bad');
    markTone('custom');
    if (save) {
      store.set('tone', 'custom');
      store.set('custom', c.hex);
    }
    return true;
  }

  function setTonePop(on) {
    $('tonePop').hidden = !on;
    $('toneBtn').classList.toggle('is-on', on);
    $('toneBtn').setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) $('customRow').hidden = !String(body.dataset.tone).startsWith('custom');
  }

  $('toneBtn').addEventListener('click', () => setTonePop($('tonePop').hidden));
  for (const sw of document.querySelectorAll('#tonePop .sw')) {
    sw.addEventListener('click', () => {
      if (sw.dataset.tone !== 'custom') {
        setTone(sw.dataset.tone, true);
        return;
      }
      setCustom(store.get('custom') || $('colorIn').value, true);
      $('customRow').hidden = false;
      setTimeout(() => $('hexIn').focus(), 30);
    });
  }
  $('colorIn').addEventListener('input', () => setCustom($('colorIn').value, false)); // 팔레트에서 움직이는 동안 미리 보기
  $('colorIn').addEventListener('change', () => setCustom($('colorIn').value, true));
  function applyHex() {
    if (!setCustom($('hexIn').value, true)) $('hexIn').classList.add('is-bad');
  }
  $('hexGo').addEventListener('click', applyHex);
  $('hexIn').addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      applyHex();
    } else if (e.key === 'Escape') {
      setTonePop(false);
    }
  });
  document.addEventListener('click', e => {
    if (!$('tonePop').hidden && !e.target.closest('#tonePop') && !e.target.closest('#toneBtn')) setTonePop(false);
  });

  const savedTone = store.get('tone') || 'smoke';
  const savedCustom = store.get('custom');
  if (savedCustom) $('swCustom').style.background = savedCustom;
  if (savedTone === 'custom' && savedCustom) setCustom(savedCustom, false);
  else setTone(savedTone, false);

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
      if (tab !== 'todo') setTab('todo', true); // 추가한 줄은 할 일 탭에 들어간다
      renderTags();
      $('addInput').value = '';
      addKind = 'ask';
      setCal(false);
      setAddDate(null);
      setTimeout(() => $('addInput').focus(), 30);
    }
  }

  async function submitAdd() {
    const text = $('addInput').value.trim();
    if (!text || busy) return;
    busy = true;
    try {
      const s = await apply({ type: 'add', text, cat: addCat, due: addDate ? md(addDate) : '', kind: addKind });
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

  // ── 탭 · 맨 위 진행 줄 ──
  $('tabTodo').addEventListener('click', () => setTab('todo', true));
  $('tabProj').addEventListener('click', () => setTab('proj', true));
  $('prog').addEventListener('click', () => {
    const name = $('prog').dataset.name;
    if (name) projOpen.set(name, true);
    setTab('proj', true);
    if (current) render(current);
  });
  setTab(store.get('tab') === 'proj' ? 'proj' : 'todo', false);

  // ── 날짜 알림 (접힌 알약 밑) ──
  // 직접 넣은 줄 중 "물어보기": 사흘 전부터 말풍선. "알림만"과 [마감] 줄: 하루 전·당일에 네모 칸
  function loadJson(k) {
    try { return JSON.parse(store.get(k) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveJson(k, obj) {
    const keys = Object.keys(obj);
    if (keys.length > 300) for (const old of keys.slice(0, keys.length - 300)) delete obj[old];
    store.set(k, JSON.stringify(obj));
  }
  let seenNotes = loadJson('seen'); // 확인·닫은 일정 알림
  let snoozed = loadJson('snooze'); // "내일"을 누른 질문 → 다시 보일 날

  function noticeQueue(s) {
    const out = [];
    const tk = dayKey(todayDate());
    for (const v of s.todo) {
      if (v.done) continue;
      const dd = ddayOf(v);
      if (!dd) continue;
      if (v.user && v.kind === 'ask') {
        if (v.asked || dd.n > 3) continue;
        if (snoozed[v.title] && snoozed[v.title] > tk) continue;
        out.push({ type: 'ask', v, dd, id: 'ask|' + v.title });
      } else if (dd.n === 0 || dd.n === 1) {
        const id = 'sched|' + v.title + '|' + dayKey(dd.at) + '|' + dd.n;
        if (seenNotes[id]) continue;
        out.push({ type: 'sched', v, dd, id });
      }
    }
    out.sort((a, b) => a.dd.n - b.dd.n || (a.type === 'ask' ? -1 : 1));
    return out;
  }

  let noticeNow = null;
  function renderNotices(s) {
    showNotice(noticeQueue(s)[0] || null);
  }

  // 말풍선 모양: 몸통 280 × h, 꼬리는 위젯이 붙은 화면 가장자리 쪽(오른쪽·왼쪽)을 향한다.
  // 기본은 오른쪽 위 꼬리. flipX면 왼쪽, flipY(알약 위에 뜰 때)면 아래 모서리로 뒤집는다
  function bubblePath(w, t, h, flipX, flipY) {
    const r = 18;
    const P = (x, y) => (flipX ? w + t - x : x) + ' ' + (flipY ? h - y : y);
    const sweep = flipX !== flipY ? 0 : 1;
    const arc = (x, y) => ' A' + r + ' ' + r + ' 0 0 ' + sweep + ' ' + P(x, y);
    return 'M' + P(r, 0) + ' L' + P(w + t - 2, 0) + ' Q' + P(w + t + 1, 0) + ' ' + P(w + t - 1, 2.5) +
      ' C' + P(w + 8, 8) + ' ' + P(w, 14) + ' ' + P(w, 28) + ' L' + P(w, h - r) + arc(w - r, h) +
      ' L' + P(r, h) + arc(0, h - r) + ' L' + P(0, r) + arc(r, 0) + ' Z';
  }

  function layoutBubble() {
    const host = $('ask');
    const w = 280;
    const t = 15;
    const flipX = body.classList.contains('anchor-left');
    const flipY = body.classList.contains('anchor-up');
    $('askBody').style.left = (flipX ? t : 0) + 'px';
    const h = Math.max(64, Math.ceil($('askBody').offsetHeight));
    const d = bubblePath(w, t, h, flipX, flipY);
    host.style.height = h + 'px';
    host.style.setProperty('--bub', "path('" + d + "')");
    const ring = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (w + t) + '" height="' + h + '"><path d="' + d + '" fill="none" stroke="black" stroke-width="16"/></svg>';
    host.style.setProperty('--ring', 'url("data:image/svg+xml,' + encodeURIComponent(ring) + '")');
    const line = $('askLine');
    line.setAttribute('width', String(w + t));
    line.setAttribute('height', String(h));
    line.setAttribute('viewBox', '0 0 ' + (w + t) + ' ' + h);
    $('askOut').setAttribute('d', d);
    $('askEdge').setAttribute('d', d);
  }

  function askSentence(n) {
    if (n < 0) return -n + '일 지났어요. 어떻게 할까요?';
    if (n === 0) return '오늘이에요. 진행해 볼까요?';
    return ['', '하루', '이틀', '사흘'][n] + ' 남았어요. 진행해 볼까요?';
  }

  function showNotice(item) {
    noticeNow = item;
    const ask = $('ask');
    const sched = $('sched');
    const id = item ? item.id : '';
    ask.hidden = !item || item.type !== 'ask';
    sched.hidden = !item || item.type !== 'sched';
    if (!item) {
      shownNotice = '';
      return;
    }
    if (item.type === 'ask') {
      const p = $('askText');
      p.textContent = '';
      p.append('현황판에 넣어 두신 ');
      const b = document.createElement('b');
      b.textContent = item.v.title;
      p.append(b, josa(item.v.title) + ' ' + askSentence(item.dd.n));
      layoutBubble();
    } else {
      const time = /(\d{1,2}:\d{2})/.exec(item.v.full || '');
      $('schedWhen').textContent = (item.dd.n === 0 ? '오늘' : '내일') + ' · ' + md(item.dd.at) + (time ? ' ' + time[1] : '');
      $('schedWhat').textContent = item.v.title;
      sched.title = item.v.title + (item.v.sub ? ' — ' + item.v.sub : '');
    }
    const el = item.type === 'ask' ? ask : sched;
    if (shownNotice !== id) {
      el.classList.remove('is-in');
      void el.offsetWidth;
      el.classList.add('is-in');
    }
    shownNotice = id;
    placeWall();
  }

  async function markAsked(v) {
    try {
      await apply({ type: 'asked', key: v.key });
    } catch (e) {}
  }

  $('askOpen').addEventListener('click', async () => {
    const it = noticeNow;
    if (!it || it.type !== 'ask') return;
    const v = it.v;
    const prompt = '현황판에 넣어 둔 "' + v.title + '"(' + md(it.dd.at) + ') 진행해 보자.' + (v.note ? ' 메모: ' + v.note : '');
    const r = await api.openClaude(prompt);
    if (r && r.ok) {
      await markAsked(v);
    } else {
      $('askText').textContent = 'Claude 앱을 열지 못했어요. 앱이 깔려 있는지 확인해 주세요.';
      layoutBubble();
    }
  });
  $('askLater').addEventListener('click', () => {
    const it = noticeNow;
    if (!it || it.type !== 'ask') return;
    snoozed[it.v.title] = dayKey(new Date(todayDate().getTime() + DAY));
    saveJson('snooze', snoozed);
    if (current) renderNotices(current);
  });
  $('askClose').addEventListener('click', () => {
    const it = noticeNow;
    if (it && it.type === 'ask') markAsked(it.v);
  });
  for (const id of ['schedOk', 'schedClose']) {
    $(id).addEventListener('click', () => {
      const it = noticeNow;
      if (!it || it.type !== 'sched') return;
      seenNotes[it.id] = 1;
      saveJson('seen', seenNotes);
      if (current) renderNotices(current);
    });
  }

  // ── 추가할 때 날짜 · 알림 방식 ──
  function setAddDate(d) {
    addDate = d;
    const btn = $('dateBtn');
    btn.classList.toggle('is-set', !!d);
    $('dateLabel').hidden = !d;
    $('dateX').hidden = !d;
    $('dateLabel').textContent = d ? dayLabel(d) : '';
    $('kind').hidden = !d;
    if (d) setKind(addKind);
    renderCal();
  }

  function setKind(k) {
    addKind = k === 'notify' ? 'notify' : 'ask';
    $('kindNotify').classList.toggle('is-on', addKind === 'notify');
    $('kindAsk').classList.toggle('is-on', addKind === 'ask');
    $('kindNotify').setAttribute('aria-checked', addKind === 'notify' ? 'true' : 'false');
    $('kindAsk').setAttribute('aria-checked', addKind === 'ask' ? 'true' : 'false');
  }

  function setCal(on) {
    $('cal').hidden = !on;
    $('dateBtn').setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) {
      const base = addDate || todayDate();
      calView = new Date(base.getFullYear(), base.getMonth(), 1);
      renderCal();
    }
  }

  function renderCal() {
    if ($('cal').hidden || !calView) return;
    const today = todayDate();
    const y = calView.getFullYear();
    const m = calView.getMonth();
    $('calMonth').textContent = y + '년 ' + (m + 1) + '월';
    const atStart = y === today.getFullYear() && m === today.getMonth();
    $('calPrev').classList.toggle('is-off', atStart);
    const grid = $('calGrid');
    grid.textContent = '';
    for (let i = 0; i < 7; i++) {
      const w = document.createElement('span');
      w.className = 'wd' + (i === 0 ? ' sun' : '');
      w.textContent = WEEK.charAt(i);
      grid.appendChild(w);
    }
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    for (let i = 0; i < first; i++) {
      const b = document.createElement('span');
      b.className = 'day blank';
      grid.appendChild(b);
    }
    for (let d = 1; d <= days; d++) {
      const at = new Date(y, m, d);
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(d);
      b.setAttribute('aria-label', (m + 1) + '월 ' + d + '일');
      let cls = 'day';
      if (at.getDay() === 0) cls += ' sun';
      if (at.getTime() === today.getTime()) cls += ' today';
      if (addDate && at.getTime() === addDate.getTime()) cls += ' sel';
      b.className = cls;
      b.disabled = at < today;
      b.addEventListener('click', () => {
        setAddDate(at);
        setTimeout(() => setCal(false), 180);
        $('addInput').focus();
      });
      grid.appendChild(b);
    }
  }

  $('dateBtn').addEventListener('click', e => {
    if (e.target.closest('#dateX')) {
      setAddDate(null);
      setCal(false);
      $('addInput').focus();
      return;
    }
    setCal($('cal').hidden);
  });
  $('calPrev').addEventListener('click', () => {
    calView = new Date(calView.getFullYear(), calView.getMonth() - 1, 1);
    renderCal();
  });
  $('calNext').addEventListener('click', () => {
    calView = new Date(calView.getFullYear(), calView.getMonth() + 1, 1);
    renderCal();
  });
  $('kindNotify').addEventListener('click', () => setKind('notify'));
  $('kindAsk').addEventListener('click', () => setKind('ask'));

  // ── 잘린 글자 전광판: 줄에 커서를 올리면 … 으로 잘린 글이 왼쪽으로 천천히 흘러간다 ──
  const MQ_HOSTS = '.it, .pjHead, #prog, #sched';
  const MQ_TARGETS = '.st, .pjSub .tx, #progNow, .schedWhat';
  let mqHost = null;
  function mqStart(el) {
    if (el.dataset.mq !== undefined || el.scrollWidth <= el.clientWidth + 1) return;
    const text = el.textContent;
    el.dataset.mq = text;
    el.classList.add('mq-on');
    const run = document.createElement('span');
    run.className = 'mqRun';
    const a = document.createElement('span');
    a.textContent = text;
    run.append(a, a.cloneNode(true));
    el.textContent = '';
    el.appendChild(run);
    run.style.setProperty('--mq-dur', Math.max(4, a.offsetWidth / 42).toFixed(1) + 's'); // 1초에 42px쯤
  }
  function mqStop(el) {
    if (el.dataset.mq === undefined) return;
    const text = el.dataset.mq;
    delete el.dataset.mq;
    el.classList.remove('mq-on');
    el.textContent = text;
  }
  function mqStopAll() {
    for (const el of document.querySelectorAll('[data-mq]')) mqStop(el);
  }
  function mqRefresh() {
    if (mqHost && mqHost.isConnected && mqHost.matches(':hover')) {
      for (const el of mqHost.querySelectorAll(MQ_TARGETS)) mqStart(el);
    }
  }
  document.addEventListener('mouseover', e => {
    if (moving || resizing) return;
    const h = e.target.closest ? e.target.closest(MQ_HOSTS) : null;
    if (h === mqHost) return;
    if (mqHost) for (const el of mqHost.querySelectorAll('[data-mq]')) mqStop(el);
    mqHost = h;
    if (h) for (const el of h.querySelectorAll(MQ_TARGETS)) mqStart(el);
  });
  document.addEventListener('mouseout', e => {
    if (e.relatedTarget || !mqHost) return;
    mqStopAll();
    mqHost = null;
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
    if (st.panelH) setPanelH(st.panelH);
    if (st.anchor) applyAnchor({ anchor: st.anchor });
    setTopUi(st.pinned);
    setStayUi(st.stay);
    if (st.startOpen) setOpen(true);
  });
  api.getWall().then(w => { if (w && w.wall) setWall(w); });
  setInterval(() => { if (current) render(current); }, 10 * 60 * 1000); // 날짜가 바뀌면 D-day 갱신

  // 시험 스크립트용
  window.__widget = {
    open: () => setOpen(true),
    close: () => setOpen(false),
    tab: t => setTab(t, false),
    ignoreRealPointer: on => { ignoreRealPointer = !!on; },
    state: () => ({ open, pinned, onTop, stay, ignoring, menuKey, suppressHover, tab, anchor: anchorKey, panelH, moving, notice: noticeNow ? noticeNow.id : '' })
  };
  load();
})();
