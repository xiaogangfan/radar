/**
 * report-filter.js — 报表查询页「业务线 → 场景 → 模型」三级联动筛选
 *
 * 背景：/report 等页面的模型下拉直接列全部模型（当前 11 个，跨 7 条业务线），
 * 模型一多就很难找。engine_model 表里已有 BUSINESS_LINE / SCENE_ID，
 * /services/v1/model/list 也已经返回这两个字段（只有中文名是null），
 * 所以纯前端就能做级联，不用改后端。
 *
 * 做法：
 *   1. 在「模型：」前面插入两个原生<select>（业务线、场景），样式对齐 antd v3；
 *   2. 过滤结果通过 React 内部实例（stateNode）写回组件的 modelList，
 *      并复用页面自己的 handleSelect 去刷新字段/规则列；
 *   3. 找不到 React 实例时降级为「打开下拉时隐藏不匹配的选项」。
 *
 * 选中值存在 sessionStorage，刷新后保留；不选业务线时行为与改造前一致（显示全部模型）。
 * 独立静态资源，index.html 里引入；不修改 main.js。
 */
(function () {
  'use strict';
  if (window.__RDFILTER__) return;
  window.__RDFILTER__ = true;

  var PAGES = /^#\/(report|event|graph|dashboard|ruleid)/;
  var NONE = '__none__'; // 「未归属」：business_line 为空的历史模型
  var BL_KEY = 'rd_rf_bl';
  var SC_KEY = 'rd_rf_scene';

  var state = {
    bl: sessionStorage.getItem(BL_KEY) || '',
    scene: sessionStorage.getItem(SC_KEY) || ''
  };
  // 左侧业务线/场景树（dimension-tree.js）已经把选择存在 rdt-filter 里，
  // 报表页沿用它作为初始值：树选了什么，这里就显示什么。
  function initFromTree() {
    if (state.bl) return;
    try {
      var raw = localStorage.getItem('rdt-filter');
      if (!raw) return;
      var f = JSON.parse(raw);
      if (f && f.kind === 'bl' && f.code) state.bl = f.code;
      else if (f && f.kind === 'scene' && f.id) {
        state.scene = String(f.id);
        state.bl = f.blCode || '';
      }
    } catch (e) { /* 忽略：树没选过或格式变了 */ }
  }
  var sceneCache = {};   // businessLine code -> sceneList
  var treeData = null;  // /dimension/tree 结果（业务线 + 场景 + 准确模型数）
  var fullList = null;   // 未过滤的完整模型列表
  var listInst = null;   // 取到 fullList 时的组件实例（换页重新挂载后重取）
  var styleInjected = false;
  var mf = null;         // 当前「模型」表单定位结果 {form,item,select}

  function token() {
    return localStorage.getItem('x-auth-token') || '';
  }

  function api(path) {
    return fetch(path, { headers: { 'x-auth-token': token() } }).then(function (r) {
      return r.json();
    });
  }

  var CSS = [
    '.rd-cascade{height:32px;min-width:170px;padding:0 28px 0 10px;font-size:14px;',
    'color:rgba(0,0,0,.65);background:#fff;border:1px solid #d9d9d9;border-radius:4px;',
    'cursor:pointer;outline:none;appearance:none;-webkit-appearance:none;',
    'background-image:url("data:image/svg+xml;charset=utf8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath fill=\'%23bfbfbf\' d=\'M604 744L895 936q-14 20-44 20H217q-30 0-44-20l291-192q20-12 44 0z\'/%3E%3C/svg%3E");',
    'background-repeat:no-repeat;background-position:right 9px center;background-size:11px;}',
    '.rd-cascade:hover{border-color:#40a9ff;}',
    '.rd-cascade:focus{border-color:#40a9ff;box-shadow:0 0 0 2px rgba(24,144,255,.2);}',
    '.rd-cascade:disabled{background:#f5f5f5;color:rgba(0,0,0,.25);cursor:not-allowed;}',
    '.rd-cascade-item{margin-right:8px;}',
    'form.rd-cascade-form{display:flex;align-items:center;flex-wrap:wrap;gap:18px;}',
    'form.rd-cascade-form .ant-form-item{display:inline-flex;align-items:center;margin:0;}',
    'form.rd-cascade-form .ant-form-item-label{float:none;width:auto;text-align:right;',
    'padding-right:8px;color:rgba(0,0,0,.65);}',
    'form.rd-cascade-form .ant-form-item-label:before{display:none;}',
    'form.rd-cascade-form .ant-form-item-control-wrapper{width:auto;}',
    'form.rd-cascade-form .ant-select{width:200px !important;}',
    '.rd-cascade-hint{color:rgba(0,0,0,.45);font-size:12px;margin-left:8px;}',
    '.rd-cascade-none{color:rgba(0,0,0,.45);}'
  ].join('');

  function ensureStyle() {
    if (styleInjected) return;
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
    styleInjected = true;
  }

  // ---- React 内部实例：拿到持有 modelList 的组件 ----
  function findModelForm() {
    var labels = document.querySelectorAll('.ant-layout-container .ant-form-item-label');
    for (var i = 0; i < labels.length; i++) {
      if (/模型/.test(labels[i].innerText || '')) {
        var item = labels[i].closest('.ant-form-item');
        var form = item && item.closest('form');
        if (form) return { form: form, item: item, select: form.querySelector('.ant-select') };
      }
    }
    return null;
  }

  function findWrapper() {
    var sel = (mf && mf.select && document.contains(mf.select)) ? mf.select : null;
    if (!sel) {
      var found = findModelForm();
      sel = found && found.select;
    }
    if (!sel) return null;
    var keys = Object.keys(sel);
    var f = null;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf('__reactInternalInstance$') === 0 || keys[i].indexOf('__reactFiber$') === 0) {
        f = sel[keys[i]];
        break;
      }
    }
    while (f) {
      var st = f.stateNode && f.stateNode.state;
      if (st && Array.isArray(st.modelList) &&
          typeof f.stateNode.handleSelect === 'function' &&
          'modelId' in st) {
        return f.stateNode;
      }
      f = f.return;
    }
    return null;
  }

  function getFullList(inst) {
    if (listInst !== inst) {
      listInst = inst;
      fullList = (inst.state.modelList || []).slice();
    } else if (!fullList || fullList.length < (inst.state.modelList || []).length) {
      // 页面自己重新拉过列表（切 tab/刷新）→ 以更大的那份为准
      fullList = (inst.state.modelList || []).slice();
    }
    return fullList || [];
  }

  function matchModel(m) {
    if (state.bl === NONE) return !m.businessLine;
    if (state.bl) return m.businessLine === state.bl;
    return true;
  }

  function matchScene(m) {
    if (!state.scene || state.scene === NONE) return true;
    return String(m.sceneId) === String(state.scene);
  }

  // 下拉里的模型数直接按真实模型数据算，不信接口里的 modelCount
  // （实测 /dimension/scene/list 的计数是 0，/dimension/tree 才准，但模型
  //   归属会变，自己算最稳。）
  function syncCounts() {
    var blSel = document.getElementById('rd-rd-bl');
    if (blSel && fullList) {
      for (var i = 0; i < blSel.options.length; i++) {
        var v = blSel.options[i].value;
        var n = v === '' ? fullList.length
          : v === NONE ? fullList.filter(function (m) { return !m.businessLine; }).length
            : fullList.filter(function (m) { return m.businessLine === v; }).length;
        var name = blSel.options[i].textContent.replace(/（[^）]*）$/, '');
        blSel.options[i].textContent = name + '（' + n + '）';
      }
    }
    var scSel = document.getElementById('rd-rd-sc');
    if (scSel && fullList && !scSel.disabled) {
      for (var j = 0; j < scSel.options.length; j++) {
        var sv = scSel.options[j].value;
        if (sv === '') continue;
        var sn = fullList.filter(function (m) {
          return String(m.sceneId) === sv && (!state.bl || m.businessLine === state.bl);
        }).length;
        var sname = scSel.options[j].textContent.replace(/（[^）]*）$/, '');
        scSel.options[j].textContent = sname + '（' + sn + '）';
      }
    }
  }

  function apply() {
    var inst = findWrapper();
    if (!inst) { fallbackFilter(); return false; }
    var all = getFullList(inst);
    syncCounts();
    var filtered = all.filter(function (m) { return matchModel(m) && matchScene(m); });

    var cur = (inst.state.modelList || []).map(function (m) { return String(m.id); }).join(',');
    var next = filtered.map(function (m) { return String(m.id); }).join(',');
    var curId = String(inst.state.modelId || '');
    var keep = filtered.filter(function (m) { return String(m.id) === curId; })[0];
    if (cur === next && (!filtered.length ? curId === '' : true) && curId) return true;

    var target = keep || filtered[0];
    inst.setState({
      modelList: filtered,
      modelId: target ? String(target.id) : ''
    }, function () {
      if (target) inst.handleSelect('modelId', String(target.id));
    });
    return true;
  }

  // 降级方案：拿不到 React 实例时，在下拉展开后把不匹配的选项藏掉
  function fallbackFilter() {
    var menu = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-dropdown-menu');
    if (!menu) return;
    var opts = menu.querySelectorAll('li');
    if (!opts.length || opts[0].getAttribute('data-rd-done')) return;
    api('/services/v1/model/list').then(function (res) {
      var list = (res && res.data && res.data.modelList) || [];
      var ok = {};
      list.forEach(function (m) {
        var pass = matchModel(m) && matchScene(m);
        ok[(m.id + '')] = pass;
        ok[(m.label || '')] = pass;
      });
      opts.forEach(function (li) {
        var key = li.getAttribute('data-meta-key') || li.textContent.trim();
        var hit = opts.length === 1 ? null : ok[key];
        li.style.display = hit === false ? 'none' : '';
      });
      menu.setAttribute('data-rd-done', '1');
    });
  }

  // ---- 渲染两个下拉：克隆「模型」那一项的结构，保证样式与原表单完全一致 ----
  function selectItem(srcItem, labelText, id, disabled) {
    var item = srcItem.cloneNode(true);
    item.className = item.className + ' rd-cascade-item';
    var lab = item.querySelector('.ant-form-item-label');
    if (lab) lab.innerHTML = '<label class="ant-form-item-required"></label>' + labelText;
    var ctrl = item.querySelector('.ant-form-item-control');
    if (ctrl) ctrl.innerHTML = '';
    var sel = document.createElement('select');
    sel.className = 'rd-cascade';
    sel.id = id;
    sel.disabled = !!disabled;
    var host = item.querySelector('.ant-form-item-control-wrapper') || item;
    host.appendChild(sel);
    return { item: item, sel: sel };
  }

  function fill(sel, items, value) {
    sel.innerHTML = '';
    items.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o.value;
      op.textContent = o.text;
      if (o.value === value) op.selected = true;
      sel.appendChild(op);
    });
    sel.disabled = !items.length;
  }

  function mount() {
    if (!PAGES.test(location.hash || '')) return false;
    if (document.getElementById('rd-rd-bl')) { mf = findModelForm(); return true; }
    mf = findModelForm();
    if (!mf || !mf.select) return false;

    ensureStyle();
    mf.form.classList.add('rd-cascade-form');
    var bl = selectItem(mf.item, '业务线：', 'rd-rd-bl', true);
    var sc = selectItem(mf.item, '场景：', 'rd-rd-sc', true);
    mf.form.insertBefore(bl.item, mf.item);
    mf.form.insertBefore(sc.item, mf.item);

    fill(bl.sel, [{ value: '', text: '请选择业务线' }], '');

    bl.sel.addEventListener('change', function () {
      state.bl = bl.sel.value;
      sessionStorage.setItem(BL_KEY, state.bl);
      state.scene = '';
      sessionStorage.removeItem(SC_KEY);
      loadScenes();
      apply();
    });

    sc.sel.addEventListener('change', function () {
      state.scene = sc.sel.value;
      sessionStorage.setItem(SC_KEY, state.scene);
      apply();
    });

    loadBusinessLines();
    return true;
  }

  function loadBusinessLines() {
    // 优先用/dimension/tree：它带准确的 modelCount（/scene/list 不填，计数是 0）
    api('/dimension/tree').then(function (res) {
      treeData = (res && res.data && res.data.tree) || [];
      if (!treeData.length) return loadBusinessLinesFallback();
      var items = [{ value: '', text: '全部业务线' }];
      treeData.forEach(function (b) {
        items.push({ value: b.code, text: b.name + '（' + (b.modelCount || 0) + '）' });
      });
      items.push({ value: NONE, text: '未归属' });
      var sel = document.getElementById('rd-rd-bl');
      if (!sel) return;
      fill(sel, items, state.bl || '');
      sel.disabled = false;
      loadScenes();
    }).catch(function () { loadBusinessLinesFallback(); });
  }

  // 兜底：tree 拿不到时用 businessLine/list + scene/list
  function loadBusinessLinesFallback() {
    api('/services/v1/dimension/businessLine/list').then(function (res) {
      var list = (res && res.data && res.data.businessLineList) || [];
      var items = [{ value: '', text: '全部业务线' }];
      list.forEach(function (b) {
        items.push({ value: b.code, text: b.name + '（' + (b.modelCount || 0) + '）' });
      });
      items.push({ value: NONE, text: '未归属' });
      var sel = document.getElementById('rd-rd-bl');
      if (!sel) return;
      fill(sel, items, state.bl || '');
      sel.disabled = false;
      loadScenes();
    });
  }

  function loadScenes() {
    var sc = document.getElementById('rd-rd-sc');
    if (!sc) return;
    if (!state.bl || state.bl === NONE) {
      fill(sc, [{ value: '', text: '全部场景' }], '');
      sc.disabled = true;
      return;
    }
    var fromTree = null;
    treeData.forEach(function (b) {
      if (b.code === state.bl) fromTree = b.children || [];
    });
    if (fromTree) { renderScenes(fromTree); return; }
    if (sceneCache[state.bl]) { renderScenes(sceneCache[state.bl]); return; }
    sc.disabled = true;
    api('/services/v1/dimension/scene/list/' + encodeURIComponent(state.bl)).then(function (res) {
      var list = (res && res.data && res.data.sceneList) || [];
      sceneCache[state.bl] = list;
      renderScenes(list);
    });
  }

  function renderScenes(list) {
    var sc = document.getElementById('rd-rd-sc');
    if (!sc) return;
    var items = [{ value: '', text: '全部场景' }];
    list.forEach(function (s) {
      items.push({ value: String(s.id), text: s.name + '（' + (s.modelCount || 0) + '）' });
    });
    fill(sc, items, state.scene || '');
    sc.disabled = false;
  }

  var tries = 0;
  (function wait() {
    if (tries === 0) initFromTree();
    mount();
    if (++tries < 120) setTimeout(wait, 250);
  })();

  if (window.__RDFILTER_TIMER__) clearInterval(window.__RDFILTER_TIMER__);
  window.__RDFILTER_TIMER__ = setInterval(function () {
    mount();
    apply();
  }, 900);
})();