# Radar 风控压测脚本集（JMeter）

Radar 风控引擎（PGmmer Radar fork）的性能与基准测试。基于 Apache JMeter 5.6.3。

## 目录结构

```
jmeter/
├── README.md                  ← 你正在读这份
├── qa-step-stress.jmx         ← QPS 压测（单线程组，1 万用户池，参数化）★压QPS用这个
├── ecommerce-riskctrl.jmx     ← 业务线模板（电商营销防刷，100 用户池）
├── data/
│   ├── stress_users.csv       ← 1 万用户/IP 池（压 QPS 用，避免热点 IP）
│   ├── ecommerce_users.csv    ← 100 用户/IP 组合（模板示例）
│   └── model-config.properties ← ECOMMERCE/LOCAL_LIFE 两个模型 GUID
└── run/                       ← 压测产物（result.jtl + html/，固定覆盖）
```

## 快速开始（压 QPS）

```bash
cd /Users/happy/Code/sandbox/radar/jmeter

/Users/happy/Code/tools/apache-jmeter-5.6.3/bin/jmeter -n -f \
    -t qa-step-stress.jmx \
    -l run/result.jtl \
    -e -o run/html
```

默认 20 线程 × 60 秒。所有参数可覆盖：

| 参数 | 默认 | 说明 |
|---|---|---|
| `-Jthreads` | 20 | 并发线程数 |
| `-Jramp` | 10 | 爬坡秒数 |
| `-Jduration` | 60 | 持续时长（秒） |
| `-JmodelGuid` | 电商 236 | 模型 GUID |
| `-Jhost` / `-Jport` | 127.0.0.1 / 6582 | 引擎地址 |

**示例**：

```bash
# 电商模型，100 线程压 3 分钟
jmeter -n -f -t qa-step-stress.jmx -Jthreads=100 -Jduration=180 \
    -l run/result.jtl -e -o run/html

# 换本地生活业务线（模型 238 / scene 5）
jmeter -n -f -t qa-step-stress.jmx \
    -JmodelGuid=E62337A9-94D9-43C3-A1B2-E8DCC0DC7118 \
    -l run/result.jtl -e -o run/html
```

产物固定两份：`run/result.jtl`（原始数据）+ `run/html/index.html`（图表报告），每次覆盖，不留多版本。

## 模型信息

| 业务线 | 场景 | 模型 ID | GUID |
|---|---|---|---|
| 电商 | 营销防刷 (scene_id=1) | 236 | `E48E20E0-4B47-4152-B21D-486F1C51500B` |
| 本地生活 | 账户安全 (scene_id=5) | 238 | `E62337A9-94D9-43C3-A1B2-E8DCC0DC7118` |

## 性能基线

优化前（2 字段索引，distinct 回表）→ 优化后（覆盖索引 `ip_lt_did_cover` / `ip_lt_uid_cover`，DISTINCT_SCAN 零回表）：

| 配置 | 优化前 | 优化后 |
|---|---|---|
| 20 线程 avg | 143~216 ms | **10~14 ms** |
| QPS | 87~150 | **355~415** |
| 单次 distinct | 8.5 ms（FETCH 回表） | **< 1 ms（docsExamined=0）** |

单机单实例（Mac 本地 docker：mongo+redis+mysql+ES 同机）的水平。生产多实例按机器数近线性扩展。

## 依赖服务

```bash
docker ps  # radar-mysql, radar-mongodb, radar-redis
pgrep -fl 'radar-(admin|engine)-watchdog'  # watchdog 保活
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6581/  # admin 200
```

## MongoDB 索引（优化已建，重建库后需重跑）

```js
// entity_236 / entity_238 都要
db.entity_236.createIndex({userIP:1, loginTime:1, deviceId:1}, {name:"ip_lt_did_cover"})
db.entity_236.createIndex({userIP:1, loginTime:1, userId:1},   {name:"ip_lt_uid_cover"})
// 原有 (userIP, loginTime) 索引已被前缀覆盖，可删：
db.entity_236.dropIndex("userIP_1_loginTime_1")
```

**注意 TTL**：`loginTime` 存的是毫秒时间戳（数字）不是 BSON Date，**TTL 索引不可用**。防止 entity 集合无限膨胀需定期清理：

```bash
# 例：保留 7 天（loginTime 为毫秒时间戳）
docker exec radar-mongodb mongosh radar --quiet --eval '
const cutoff = Date.now() - 7*24*3600*1000;
["entity_236","entity_238"].forEach(c => {
  const r = db[c].deleteMany({loginTime: {$lt: cutoff}});
  print(c, "deleted:", r.deletedCount);
});'
```

## 决策含义

| 字段 | 含义 |
|---|---|
| `score` | 规则命中后总贡献分 |
| `risk` | `pass`(<40)、`warn/review`(40-80)、`reject`(>=80) |

## 配套脚本

| 路径 | 作用 |
|---|---|
| `/tmp/jmeter-setup.sh` | 准备业务数据（拷模型/激活/灌种子事件） |
| `/tmp/radar-admin-watchdog.py` | 保活 admin 6581 |
| `/tmp/radar-engine-watchdog.py` | 保活 engine 6582 |
