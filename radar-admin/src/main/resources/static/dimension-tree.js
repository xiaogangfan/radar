/**
 * dimension-tree.js — 业务线/场景树 · 注入版 v2（radar-admin 原前端增强）
 *
 * 以静态资源方式打进 BOOT-INF/classes/static/，由 index.html 引入。
 * 本版原则：不重复造原前端已有的功能，只做「场景上下文」的注入——
 *
 *   1. 左侧挂「业务线 / 场景」树（数据源 /services/v1/dimension/tree）；
 *   2. 点击业务线/场景 → 以 businessLine / sceneId 过滤，刷新【原前端的
 *      模型列表页】（#/modelList 的表格，分页、搜索、新建等全部用原逻辑）；
 *   3. 「新建模型」完全用原前端的按钮与弹窗；本脚本只在 fetch 层把当前
 *      场景上下文透明注入：
 *        - 列表查询 POST /model（带 pageNo 的）→ 追加 sceneId/businessLine；
 *        - 模板复制 POST /model/copy → 成功后自动补一次 PUT /model 挂场景；
 *        - 空白新建 PUT /model（无 id）→ 请求体追加 businessLine/sceneId。
 *      场景未选中时不注入，原前端行为与线上完全一致。
 *
 * 不修改 main.js，移除 index.html 中对本文件的引用即可整体下线。
 */
(function () {
  'use strict';
  if (window.__RDT__) return;
  window.__RDT__ = true;

  var API = '/services/v1';
  var TOKEN_KEY = 'x-auth-token';
  var FILTER_KEY = 'rdt-filter';
  var PRIMARY = '#108ee9';
  var expanded = {};   // bl.code -> bool
  var treeData = [];
  var filter = null;   // null | {kind:'bl', code, name} | {kind:'scene', id, name, blName, blCode}

  /* ---------------- utilities ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }

  function api(path, method, body) {
    var headers = { 'x-auth-token': token() };
    var opts = { credentials: 'include', headers: headers, method: method || 'GET' };
    if (method && method !== 'GET' && body != null) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(API + path, opts).then(function (r) { return r.json(); });
  }

  var toastTimer = null;
  function toast(msg, type) {
    var el = $('#rdt-toast');
    if (!el) { el = document.createElement('div'); el.id = 'rdt-toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.className = 'rdt-toast show ' + (type || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'rdt-toast'; }, 2400);
  }

  /* ---------------- styles ---------------- */
  var CSS = ''
    + '#rdt-sidebar{position:fixed;left:0;top:0;bottom:0;width:230px;background:#fff;border-right:1px solid #e9e9e9;z-index:990;display:flex;flex-direction:column;font-size:12px;box-shadow:2px 0 6px rgba(0,0,0,.04);}'
    + 'body.rdt-open{padding-left:230px;}'
    + '.rdt-head{padding:10px 12px;border-bottom:1px solid #e9e9e9;background:#fafafa;display:flex;align-items:center;}'
    + '.rdt-head .t{font-weight:600;font-size:13px;color:rgba(0,0,0,.85);flex:1;}'
    + '.rdt-head button{border:1px solid #d9d9d9;background:#fff;border-radius:4px;cursor:pointer;font-size:11px;padding:1px 7px;margin-left:4px;color:#666;}'
    + '.rdt-head button:hover{color:' + PRIMARY + ';border-color:' + PRIMARY + ';}'
    + '.rdt-stat{padding:6px 12px;color:#999;font-size:11px;border-bottom:1px solid #f0f0f0;background:#fff;}'
    + '.rdt-stat b{color:' + PRIMARY + ';font-weight:500;}'
    + '#rdt-tree{flex:1;overflow:auto;padding:6px 0;}'
    + '#rdt-tree ul{list-style:none;margin:0;padding:0;}'
    + '.rdt-row{display:flex;align-items:center;gap:5px;padding:4px 10px;cursor:pointer;margin:1px 6px;border-radius:4px;}'
    + '.rdt-row:hover{background:#ecf6fd;}'
    + '.rdt-row.sel{background:#d2eafb;color:' + PRIMARY + ';font-weight:500;}'
    + '.rdt-caret{display:inline-block;width:12px;text-align:center;color:#999;font-size:9px;transition:transform .12s;}'
    + '.rdt-caret.open{transform:rotate(90deg);}'
    + '.rdt-row .lbl{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
    + '.rdt-row .cnt{color:#999;font-size:10px;background:#f4f4f4;padding:0 6px;border-radius:8px;}'
    + '.rdt-children{padding-left:16px;}'
    + '.rdt-empty{padding:30px 14px;color:#999;text-align:center;}'
    + '.rdt-divider{height:1px;background:#f0f0f0;margin:4px 12px;}'
    + '#rdt-reopen{position:fixed;left:0;top:90px;z-index:990;background:' + PRIMARY + ';color:#fff;padding:10px 4px;border-radius:0 4px 4px 0;cursor:pointer;font-size:12px;writing-mode:vertical-lr;letter-spacing:2px;box-shadow:2px 0 6px rgba(0,0,0,.1);display:none;}'
    + '.rdt-toast{position:fixed;top:70px;right:24px;padding:7px 14px;border-radius:4px;font-size:13px;color:#fff;background:rgba(0,0,0,.75);opacity:0;transition:opacity .2s;pointer-events:none;z-index:1200;}'
    + '.rdt-toast.show{opacity:1;}'
    + '.rdt-toast.err{background:#c0392b;}';

  /* ---------------- mount chrome ---------------- */
  function ensureChrome() {
    if ($('#rdt-sidebar')) return;
    var style = document.createElement('style');
    style.id = 'rdt-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    var sb = document.createElement('div');
    sb.id = 'rdt-sidebar';
    sb.innerHTML = ''
      + '<div class="rdt-head"><span class="t">业务线 / 场景</span>'
      + '<button id="rdt-refresh" title="刷新">刷新</button>'
      + '<button id="rdt-fold" title="收起">«</button></div>'
      + '<div class="rdt-stat" id="rdt-stat"></div>'
      + '<div id="rdt-tree"></div>';
    document.body.appendChild(sb);

    var reopen = document.createElement('div');
    reopen.id = 'rdt-reopen';
    reopen.textContent = '业务线';
    reopen.title = '展开业务线树';
    document.body.appendChild(reopen);

    $('#rdt-refresh').addEventListener('click', function () { loadTree(); });
    $('#rdt-fold').addEventListener('click', function () { setFolded(true); });
    reopen.addEventListener('click', function () { setFolded(false); });
  }

  function setFolded(folded) {
    var sb = $('#rdt-sidebar');
    if (!sb) return;
    sb.style.display = folded ? 'none' : 'flex';
    $('#rdt-reopen').style.display = folded ? 'block' : 'none';
    document.body.classList.toggle('rdt-open', !folded && visible);
    try { localStorage.setItem('rdt-folded', folded ? '1' : '0'); } catch (e) {}
  }
  function isFolded() { try { return localStorage.getItem('rdt-folded') === '1'; } catch (e) { return false; } }

  /* ---------------- tree data ---------------- */
  function loadTree() {
    if (!token()) return;
    api('/dimension/tree').then(function (j) {
      if (!j.success) { treeData = []; renderTree(); return; }
      treeData = (j.data && j.data.tree) || [];
      renderTree();
      renderStat();
    }).catch(function () {});
  }

  function renderStat() {
    var stat = $('#rdt-stat');
    if (!stat) return;
    if (filter) {
      stat.innerHTML = '筛选：<b>' + esc(filter.kind === 'scene'
        ? (filter.blName ? filter.blName + ' / ' : '') + filter.name
        : filter.name) + '</b>';
    } else {
      var scenes = 0, models = 0;
      treeData.forEach(function (bl) { scenes += bl.sceneCount || 0; models += bl.modelCount || 0; });
      stat.textContent = treeData.length + ' 业务线 · ' + scenes + ' 场景 · ' + models + ' 模型';
    }
  }

  function renderTree() {
    var el = $('#rdt-tree');
    if (!el) return;
    el.innerHTML = '';
    if (!treeData.length) {
      el.innerHTML = '<div class="rdt-empty">暂无业务线数据</div>';
      return;
    }
    var ul = document.createElement('ul');

    // 「全部模型」= 清除筛选，恢复原列表
    var allLi = document.createElement('li');
    var allRow = document.createElement('div');
    allRow.className = 'rdt-row' + (filter ? '' : ' sel');
    allRow.innerHTML = '<span class="rdt-caret" style="visibility:hidden">▶</span><span class="lbl">全部模型</span>';
    allRow.addEventListener('click', function () {
      if (!filter) return;
      setFilter(null);
      refreshModelList();
    });
    allLi.appendChild(allRow);
    ul.appendChild(allLi);

    var sep = document.createElement('li');
    sep.className = 'rdt-divider';
    ul.appendChild(sep);

    treeData.forEach(function (bl) {
      var open = expanded[bl.code] !== false;
      var li = document.createElement('li');
      var row = document.createElement('div');
      var isSel = filter && filter.kind === 'bl' && filter.code === bl.code;
      row.className = 'rdt-row' + (isSel ? ' sel' : '');
      row.innerHTML = '<span class="rdt-caret' + (open ? ' open' : '') + '">▶</span>'
        + '<span class="lbl" title="' + esc(bl.name) + '">' + esc(bl.name) + '</span>'
        + '<span class="cnt">' + (bl.sceneCount || 0) + '</span>';
      var kids = document.createElement('ul');
      kids.className = 'rdt-children';
      kids.style.display = open ? '' : 'none';
      (bl.children || []).forEach(function (sc) {
        var sli = document.createElement('li');
        var srow = document.createElement('div');
        var sSel = filter && filter.kind === 'scene' && filter.id === sc.id;
        srow.className = 'rdt-row' + (sSel ? ' sel' : '');
        srow.innerHTML = '<span class="rdt-caret" style="visibility:hidden">▶</span>'
          + '<span class="lbl" title="' + esc(sc.name) + '">' + esc(sc.name) + '</span>'
          + '<span class="cnt">' + (sc.modelCount || 0) + '</span>';
        srow.addEventListener('click', function (e) {
          e.stopPropagation();
          applySceneFilter(sc, bl);
        });
        sli.appendChild(srow);
        kids.appendChild(sli);
      });
      row.addEventListener('click', function (ev) {
        var onCaret = ev.target.classList && ev.target.classList.contains('rdt-caret');
        if (onCaret) {
          var willOpen = kids.style.display === 'none';
          expanded[bl.code] = willOpen;
          var caret = $('.rdt-caret', row);
          if (caret) caret.className = 'rdt-caret' + (willOpen ? ' open' : '');
          kids.style.display = willOpen ? '' : 'none';
          return;
        }
        expanded[bl.code] = true;
        applyBlFilter(bl);
      });
      li.appendChild(row);
      li.appendChild(kids);
      ul.appendChild(li);
    });
    el.appendChild(ul);
  }

  /* ---------------- filter + refresh original list ---------------- */
  function setFilter(f) {
    filter = f;
    try {
      if (f) localStorage.setItem(FILTER_KEY, JSON.stringify(f));
      else localStorage.removeItem(FILTER_KEY);
    } catch (e) {}
    renderStat();
    renderTree();
  }

  function applyBlFilter(bl) {
    setFilter({ kind: 'bl', code: bl.code, name: bl.name });
    refreshModelList();
  }

  function applySceneFilter(sc, bl) {
    setFilter({ kind: 'scene', id: sc.id, name: sc.name, blName: bl ? bl.name : '', blCode: bl ? bl.code : '' });
    refreshModelList();
  }

  /** 刷新【原前端】的模型列表：跳到 #/modelList；已在则快速切路由强制重挂载 */
  function refreshModelList() {
    if (location.hash.indexOf('#/modelList') === 0) {
      location.hash = '#/welcome';
      setTimeout(function () { location.hash = '#/modelList'; }, 50);
    } else {
      location.hash = '#/modelList';
    }
  }

  /* ---------------- fetch 包装：把场景上下文注入原前端请求 ---------------- */
  function urlOf(input) {
    if (typeof input === 'string') return input;
    if (input && input.url) return input.url;
    return '';
  }

  function patchFetch() {
    if (window.__RDT_FETCH_PATCHED__) return;
    window.__RDT_FETCH_PATCHED__ = true;
    var origFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      var url = urlOf(input);
      var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var body = (init && init.body) || null;
      var isJsonBody = body && typeof body === 'string';

      // ① 列表查询：POST /model，body 带 pageNo → 按当前筛选追加过滤条件
      if (method === 'POST' && (url === API + '/model' || url === '/services/v1/model') && isJsonBody) {
        try {
          var q = JSON.parse(body);
          if (q && q.pageNo != null) {
            if (filter && filter.kind === 'scene') q.sceneId = filter.id;
            else if (filter && filter.kind === 'bl') q.businessLine = filter.code;
            init = Object.assign({}, init, { body: JSON.stringify(q) });
          }
        } catch (e) {}
      }

      // ② 模板复制：POST /model/copy → 成功后自动挂当前场景（补一次 PUT /model）
      if (method === 'POST' && (url === API + '/model/copy' || url === '/services/v1/model/copy')) {
        var label = '';
        if (isJsonBody) { try { label = (JSON.parse(body) || {}).label || ''; } catch (e) {} }
        return origFetch(input, init).then(function (resp) {
          if (!filter || filter.kind !== 'scene') return resp;
          return resp.clone().json().then(function (j) {
            if (j && j.success && j.data && j.data.id) {
              return origFetch(API + '/model', {
                credentials: 'include',
                method: 'PUT',
                headers: { 'x-auth-token': token(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: j.data.id, label: label, businessLine: filter.blCode, sceneId: filter.id })
              }).then(function () {
                toast('模型已挂到场景「' + filter.name + '」');
                loadTree();
                return resp;
              }).catch(function () { return resp; });
            }
            return resp;
          }).catch(function () { return resp; });
        });
      }

      // ③ 空白新建：PUT /model 且 body 无 id → 追加业务线/场景
      if (method === 'PUT' && (url === API + '/model' || url === API + '/model/' || url === '/services/v1/model' || url === '/services/v1/model/') && isJsonBody) {
        try {
          var m = JSON.parse(body);
          if (m && m.id == null && filter) {
            if (filter.kind === 'scene') {
              m.businessLine = filter.blCode;
              m.sceneId = filter.id;
            } else {
              m.businessLine = filter.code;
            }
            init = Object.assign({}, init, { body: JSON.stringify(m) });
            var p = origFetch(input, init);
            p.then(function (r) {
              return r.clone().json().then(function (j) {
                if (j && j.success) loadTree();
              }).catch(function () {});
            }).catch(function () {});
            return p;
          }
        } catch (e) {}
      }

      return origFetch(input, init);
    };
  }

  /* ---------------- visibility control ---------------- */
  var visible = false;
  var loaded = false;
  var restored = false;

  function update() {
    var t = token();
    var onLogin = location.hash.indexOf('#/login') === 0;
    var shouldShow = !!t && !onLogin;
    if (shouldShow && !visible) {
      visible = true;
      ensureChrome();
      setFolded(isFolded());
      if (!loaded) {
        loaded = true;
        // 恢复上次筛选（原列表首次查询发生在补丁安装前，需强制刷一次）
        try {
          var saved = localStorage.getItem(FILTER_KEY);
          if (saved) { filter = JSON.parse(saved); }
        } catch (e) {}
        renderStat();
        loadTree();
        if (filter && !restored && location.hash.indexOf('#/modelList') === 0) {
          restored = true;
          refreshModelList();
        }
      } else {
        renderTree();
        renderStat();
      }
    } else if (!shouldShow && visible) {
      visible = false;
      var sb = $('#rdt-sidebar');
      if (sb) sb.style.display = 'none';
      var ro = $('#rdt-reopen');
      if (ro) ro.style.display = 'none';
      document.body.classList.remove('rdt-open');
      setFilter(null);
    }
  }

  window.addEventListener('hashchange', update);
  setInterval(update, 1000);
  patchFetch();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', update);
  } else {
    update();
  }
})();
