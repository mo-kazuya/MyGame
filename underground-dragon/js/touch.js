'use strict';
// スマホ・タブレット用のタッチ操作。画面の十字キーとボタンを、キーボードと同じ keys / pressed に流し込む。
// iOS Safari では pointer イベントがスクロール扱いで途中キャンセルされることがあるため、
// タッチは touch イベントで直接受け取り、preventDefault でスクロールや拡大を止める。
// マウス（パソコンでの確認用）は pointer イベントで受け取る。

(function () {
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (isTouch) document.body.classList.add('touch');

  function press(k) {
    if (!keys[k]) pressed[k] = true;
    keys[k] = true;
  }
  function release(k) { keys[k] = false; }

  function eachTouch(e, fn) {
    for (let i = 0; i < e.changedTouches.length; i++) fn(e.changedTouches[i]);
  }

  // el に「押した・動かした・離した」を、タッチとマウスの両方から届ける
  function bind(el, { down, move, up }) {
    const active = new Set(); // 押している指（touch の identifier、マウスは 'mouse'）
    const opts = { passive: false };
    el.addEventListener('touchstart', e => {
      e.preventDefault();
      eachTouch(e, t => { active.add(t.identifier); down(t.clientX, t.clientY, t.identifier); });
    }, opts);
    el.addEventListener('touchmove', e => {
      e.preventDefault();
      eachTouch(e, t => { if (active.has(t.identifier)) move(t.clientX, t.clientY, t.identifier); });
    }, opts);
    const end = e => {
      e.preventDefault();
      eachTouch(e, t => { if (active.delete(t.identifier)) up(t.identifier); });
    };
    el.addEventListener('touchend', end, opts);
    el.addEventListener('touchcancel', end, opts);

    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return; // タッチは上で処理済み
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      active.add('mouse');
      down(e.clientX, e.clientY, 'mouse');
    });
    el.addEventListener('pointermove', e => { if (e.pointerType !== 'touch' && active.has('mouse')) move(e.clientX, e.clientY, 'mouse'); });
    const pend = e => { if (e.pointerType !== 'touch' && active.delete('mouse')) up('mouse'); };
    el.addEventListener('pointerup', pend);
    el.addEventListener('pointercancel', pend);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  // 十字キー：中心からの向きで8方向を判定。指を滑らせて方向を変えられる
  const pad = document.getElementById('dpad');
  const dirs = ['left', 'right', 'up', 'down'];
  const marks = {};
  for (const d of dirs) marks[d] = pad.querySelector(`[data-dir="${d}"]`);
  let padFinger = null;
  function setPad(x, y) {
    const r = pad.getBoundingClientRect();
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    const want = {};
    if (len > r.width * 0.1) {
      const nx = dx / len, ny = dy / len;
      want.right = nx > 0.38; want.left = nx < -0.38;
      want.down = ny > 0.38; want.up = ny < -0.38;
    }
    for (const d of dirs) {
      if (want[d]) press(d); else release(d);
      marks[d].classList.toggle('on', !!want[d]);
    }
  }
  function clearPad() {
    padFinger = null;
    for (const d of dirs) { release(d); marks[d].classList.remove('on'); }
  }
  bind(pad, {
    down: (x, y, id) => { padFinger = id; setPad(x, y); },
    move: (x, y, id) => { if (id === padFinger) setPad(x, y); },
    up: id => { if (id === padFinger) clearPad(); },
  });

  // ボタン：押している間だけキーを押した状態にする（複数の指で同時押しできる）
  document.querySelectorAll('.tbtn[data-key]').forEach(btn => {
    const k = btn.dataset.key;
    let fingers = 0;
    bind(btn, {
      down: () => { fingers++; press(k); btn.classList.add('on'); },
      move: () => {},
      up: () => { if (--fingers <= 0) { fingers = 0; release(k); btn.classList.remove('on'); } },
    });
  });

  // 画面を離れたり裏に回ったりしたら、押しっぱなしを解除する
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearPad(); for (const k in keys) keys[k] = false; document.querySelectorAll('.tbtn.on').forEach(b => b.classList.remove('on')); }
  });
})();
