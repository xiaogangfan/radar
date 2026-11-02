/**
 * manual-entry.js — 「使用手册」入口（radar-admin 原前端增强）
 *
 * 单一入口，打开内置图文版模型配置使用手册（/manual.html）：
 *   顶栏通栏右上角 —— 所有页面通用（同时隐藏原来的 GVP 徽标）
 * 说明：早先在模型列表页工具栏也注入过一个同名按钮，与顶栏重复，已移除。
 *
 * 以静态资源方式打进 BOOT-INF/classes/static/，由 index.html 引入。
 * 不修改 main.js；移除 index.html 中对本文件的引用即可整体下线。
 */
(function () {
  'use strict';
  if (window.__RMANUAL__) return;
  window.__RMANUAL__ = true;

  var ICON_BOOK =
    '<svg viewBox="64 64 896 896" focusable="false" width="1em" height="1em" fill="currentColor" aria-hidden="true">' +
    '<path d="M832 64H192c-17.7 0-32 14.3-32 32v832c0 17.7 14.3 32 32 32h640c17.7 0 32-14.3 32-32V96c0-17.7-14.3-32-32-32zm-260 72h96v209.9L621.5 312 572 347.9V136z"></path>' +
    '</svg>';

  var CSS = [
    '.ant-layout-header{position:relative;}',
    '#rd-manual{position:absolute;display:flex;align-items:center;height:32px;padding:0 14px;',
    'border:1px solid #91caff;border-radius:16px;background:linear-gradient(135deg,#e6f4ff,#f0f8ff);',
    'cursor:pointer;transition:all .2s;user-select:none;white-space:nowrap;z-index:10;}',
    '#rd-manual:hover{background:linear-gradient(135deg,#1890ff,#096dd9);border-color:#1890ff;',
    'box-shadow:0 2px 8px rgba(24,144,255,.35);}',
    '#rd-manual .rd-m-ico{color:#1890ff;font-size:15px;display:flex;align-items:center;margin-right:6px;}',
    '#rd-manual .rd-m-txt{font-size:13px;color:#096dd9;font-weight:500;letter-spacing:.5px;}'
  ].join('');

  function openManual() {
    window.open('/manual.html?v=5', '_blank');
  }

  function ensureStyle() {
    if (document.getElementById('rd-manual-style')) return;
    var style = document.createElement('style');
    style.id = 'rd-manual-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // GVP 徽标（gitee star.svg）不展示；React 重渲染后会被重建，所以每次同步都再藏一次
  function hideGvpBadge() {
    var badges = document.querySelectorAll('.ant-layout-logo');
    var hit = false;
    for (var i = 0; i < badges.length; i++) {
      var img = badges[i].querySelector('img[src*="gitee.com"]');
      if (!img) continue;
      hit = true;
      if (badges[i].style.display !== 'none') badges[i].style.display = 'none';
    }
    return hit;
  }

  function inject() {
    var header = document.querySelector('.ant-layout-header');
    var wrapper = header && header.querySelector('.ant-layout-wrapper');
    if (!wrapper) return false;
    hideGvpBadge();
    if (document.getElementById('rd-manual')) return true;

    // 锚点：右上角「还可见」的元素里最靠左的那个，按钮放它左侧
    var logos = wrapper.querySelectorAll('.ant-layout-logo');
    var anchor = null;
    for (var i = 0; i < logos.length; i++) {
      if (logos[i].style.display === 'none') continue;
      var lr = logos[i].getBoundingClientRect();
      if (lr.width === 0) continue;
      if (lr.left > window.innerWidth / 2 &&
          (!anchor || lr.left < anchor.getBoundingClientRect().left)) {
        anchor = logos[i];
      }
    }

    ensureStyle();

    var btn = document.createElement('div');
    btn.id = 'rd-manual';
    btn.title = '查看模型配置使用手册（图文版）';
    btn.innerHTML =
      '<span class="rd-m-ico">' + ICON_BOOK + '</span>' +
      '<span class="rd-m-txt">使用手册</span>';
    btn.addEventListener('click', openManual);
    header.appendChild(btn);

    // 用 right 定位（float 布局下 left 测量不稳定）：
    // 按钮右缘 = 锚点左缘 - 14px 间距；没有锚点时贴右边距
    var hr = header.getBoundingClientRect();
    btn.style.top = Math.max(0, (hr.height - 32) / 2) + 'px';
    btn.style.right = anchor
      ? Math.max(0, hr.right - anchor.getBoundingClientRect().left + 14) + 'px'
      : '14px';
    return true;
  }

  // React 渲染是异步的，轮询等待顶栏出现
  var tries = 0;
  (function wait() {
    inject();
    if (++tries < 100) setTimeout(wait, 200);
  })();

  // SPA 路由切换后顶栏会被重建；顺带持续隐藏 GVP 徽标
  if (window.__RMANUAL_TIMER__) clearInterval(window.__RMANUAL_TIMER__);
  window.__RMANUAL_TIMER__ = setInterval(function () {
    inject();
    hideGvpBadge();
  }, 800);
})();
