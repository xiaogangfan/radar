// 手册 §9.2 单发验证 + §9.3 攻击场景复现
// 用法: node verify-manual-903.js
const BASE = 'http://127.0.0.1:6582/services/v1/upload';
const GUID = 'E48E20E0-4B47-4152-B21D-486F1C51500B'; // 模型 236，与手册一致

function post(json) {
  return fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  }).then((r) => r.text());
}

function fmt(raw) {
  try {
    const j = JSON.parse(raw);
    return {
      success: j.success,
      msg: j.msg || '',
      act: j.activations ? JSON.stringify(j.activations) : '',
      hits: j.hitsDetail ? JSON.stringify(j.hitsDetail) : '',
      abs: j.abstractions ? JSON.stringify(j.abstractions).slice(0, 220) : '',
    };
  } catch (e) {
    return { raw: raw.slice(0, 220) };
  }
}

(async () => {
  const TS = Date.now();
  // eventId 必须每次运行都换：entity_236 以 eventId 去重，重复的会被直接丢弃，
  // 导致「同 IP 换 N 个设备」的第二次验证跑不出reject（手册 §11 踩过的坑）。
  const RUN = String(TS).slice(-8);

  console.log('=== §9.2 单发（IP 9.9.9.9 / 设备 d1）===');
  const r1 = await post({
    guid: GUID, reqId: 'verify-1',
    jsonInfo: { loginTime: TS, userId: 'u1', eventId: `evt-${RUN}-single`, userIP: '9.9.9.9', deviceId: 'd1', mobile: '13800000001', passwd: 'x', os: 'app', channel: 'app' },
  });
  console.log(JSON.stringify(fmt(r1), null, 1));

  console.log(`\n=== §9.3 攻击场景（同 IP 7.7.7.7 换 3 个设备，本次 RUN=${RUN}）===`);
  for (let i = 1; i <= 3; i++) {
    const raw = await post({
      guid: GUID, reqId: `demo-${RUN}-${i}`,
      jsonInfo: {
        loginTime: TS, userId: `demo-${RUN}-${i}`, eventId: `evt-${RUN}-demo-${i}`,
        userIP: '7.7.7.7', deviceId: `dev-${i}`, mobile: `1380000000${i}`,
        passwd: 'x', os: 'app', channel: 'app',
      },
    });
    const f = fmt(raw);
    console.log(`第${i}次(dev-${i}): success=${f.success} ${f.act} ${f.hits}`);
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log('\n=== 换新 IP（6.6.6.6）应回到 pass ===');
  const r4 = await post({
    guid: GUID, reqId: `demo-${RUN}-4`,
    jsonInfo: { loginTime: TS, userId: 'demo-4', eventId: `evt-${RUN}-other`, userIP: '6.6.6.6', deviceId: 'dev-x', mobile: '13800000009', passwd: 'x', os: 'app', channel: 'app' },
  });
  console.log(JSON.stringify(fmt(r4).act));
})();