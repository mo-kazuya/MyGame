'use strict';
// スマホ・タブレット用のタッチ操作。画面の十字キーとボタンを、キーボードと同じ keys / pressed に流し込む。

(function () {
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (isTouch) document.body.classList.add('touch');

  function press(k) {
    if (!keys[k]) pressed[k] = true;
    keys[k] = true;
  }
  function release(k) { keys[k] = false; }

  // 十字キー：中心からの向きで8方向を判定。指を滑らせて方向を変えられる
  const pad = document.getElementById('dpad');
  const dirs = ['left', 'right', 'up', 'down'];
  let padPointer = null;
  function setPad(e) {
    const r = pad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    const want = {};
    if (len > r.width * 0.12) {
      const nx = dx / len, ny = dy / len;
      want.right = nx > 0.38; want.left = nx < -0.38;
      want.down = ny > 0.38; want.up = ny < -0.38;
    }
    for (const d of dirs) {
      if (want[d]) press(d); else release(d);
      pad.querySelector(`[data-dir="${d}"]`).classList.toggle('on', !!want[d]);
    }
  }
  function clearPad() {
    padPointer = null;
    for (const d of dirs) { release(d); pad.querySelector(`[data-dir="${d}"]`).classList.remove('on'); }
  }
  pad.addEventListener('pointerdown', e => {
    e.preventDefault();
    padPointer = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    setPad(e);
  });
  pad.addEventListener('pointermove', e => { if (e.pointerId === padPointer) setPad(e); });
  pad.addEventListener('pointerup', e => { if (e.pointerId === padPointer) clearPad(); });
  pad.addEventListener('pointercancel', e => { if (e.pointerId === padPointer) clearPad(); });

  // ボタン：押している間だけキーを押した状態にする
  document.querySelectorAll('.tbtn[data-key]').forEach(btn => {
    const k = btn.dataset.key;
    const up = () => { release(k); btn.classList.remove('on'); };
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      press(k);
      btn.classList.add('on');
    });
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
  });

  // 長押しメニューやダブルタップ拡大を防ぐ
  document.querySelectorAll('.tpad').forEach(el => el.addEventListener('contextmenu', e => e.preventDefault()));
})();
