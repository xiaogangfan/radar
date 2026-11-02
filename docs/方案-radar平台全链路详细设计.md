# 方案：Radar 平台全链路详细设计

关联产出：`docs/详细设计-radar平台全链路.md`
已有文档：`docs/radar-data-flow.md`（流程概览）、`docs/deployment-local.md`（本地部署）

---

## 1. 背景与目标

仓库里原本只有 4 KB 的 `radar-data-flow.md`，粒度不够支撑二次开发：改一条规则要不要重启引擎、滑窗口径按谁的时间算、结果缓存 key 是什么、ES 里存了什么，都得翻源码，而且容易读错。本次调研实测发现了至少 7 处反直觉实现。

目标：产出一份**能照着改代码**的全链路详细设计，把"配置模型 → 引擎计算 → 结果回写"拆到类、方法、表列、缓存 key 的粒度，并把反直觉点显式标注出来。

## 2. 范围

**覆盖**：Admin 配置入口与发布点；配置热推链路（Redis 频道、订阅方式、本地缓存与失效策略）；Engine 决策链路（字段校验 → 预处理 → Mongo 落库 → 抽象滑窗 → 名单 → 规则 → 策略定级 → 返回）；结果写与落地（Redis 结果缓存 / Mongo 事件与 TTL / ES 异步归档 / 查询接口）；数据模型（MySQL 表与列语义、Mongo 集合与索引、ES 索引与别名、Redis key 与频道）。

**不覆盖**：前端源码（不在本仓库，只描述它调的后端接口与 `radar-admin/src/main/resources/static/*.js` 静态增强）；机器学习子链路（`Estimator` 只写调用时机）；`radar-kafka-demo`（独立演示模块）。

## 3. 调研方法

| 结论类型 | 核验方式 | 示例 |
|---|---|---|
| 接口与调用链 | 读 Controller + Service 源码 | `/services/v1/upload` → `MainController` → `RiskAnalysisEngineServiceImpl.uploadInfo` |
| 运行时行为 | 本地起 admin(6580) / engine(6581)，真实 curl 打请求 | 三连击复现：pass/0 → pass/0 → reject/100；分数、hitsDetail、respTimes 取自真实响应 |
| 存储结构 | 直连 MySQL / Mongo / Redis 查 | `show columns from engine_rule`、`entity_236` 集合、`radar_channel_*` 频道常量 |
| 配置口径 | 对照初始化 SQL 种子数据 | `radar-init.sql` 里 `log_ip_10_min_qty` 的 `SEARCH_INTERVAL_TYPE=12/VALUE=10` 反推"type 就是 Calendar 字段常量" |

原则：每条结论都要能指到具体的类 / 方法 / 行号 / SQL 种子数据；推不动的一律进"缺口与易错点"，不含糊过去。

## 4. 详细设计的章节结构

| 章 | 内容 | 回答的问题 |
|---|---|---|
| 1 | 总体架构 | 有几个进程、端口与依赖、谁读谁写 |
| 2 | 进程与配置 | local profile 关键配置项 |
| 3 | Admin 配置侧 | 改一个配置走哪些接口、在哪个 Service 落库 |
| 4 | 配置热推 | 为什么改完不用重启、推失效还是推数据、最多多久自愈 |
| 5 | Engine 决策主链路 | 一次 upload 请求的完整时序与 7 个阶段职责 |
| 6 | 抽象滑窗统计 | 窗口按谁的时间、两种聚合实现的差异、为什么算不出来时是 -1 |
| 7 | 规则与策略 | 得分公式、五个操作符、MAX / hitsDetail / bottom、阈值取等号如何归属 |
| 8 | 结果回写与查询 | Redis → Mongo → ES 三条落地路径，谁写谁读 |
| 9 | 数据模型 | MySQL 表 / Mongo 集合与索引 / ES 索引与别名 / Redis key 与频道 |
| 10 | 错误码与排障 | 返回码对应什么失败、按什么顺序查 |
| 11 | 非功能与风险 | 性能热点、可用性缺口、并发竞态点 |
| 12 | 附录：源码索引 | 关键类的绝对路径表 |

## 5. 交付与验收

1. `docs/详细设计-radar平台全链路.md`（含部署架构图 + 决策时序图两张 mermaid）
2. `docs/方案-radar平台全链路详细设计.md`（本文件）
3. `docs/radar-data-flow.md` 顶部加交叉引用

验收：新人按第 5 节时序图能讲出一次请求的 7 个阶段；第 7 节公式能手工复算示例模型的规则得分；第 9 节能直接回答"这个字段存在哪、被谁读"。

## 6. 已知缺口（本次只登记、不修，同见详细设计第 11 节）

| 级别 | 缺口 | 影响 |
|---|---|---|
| P0 | 策略启停接口 `updateStatus` 不发 Redis 通知 | 后台启停策略后引擎不生效，等 Caffeine 1 小时过期 |
| P0 | 名单字段 meta 保存会清空记录却不发布通知 | 改名单元数据后引擎内存名单偏脏、需重启 |
| P1 | 名单本地缓存是静态 HashMap，无 TTL、无回源 | Redis 断连期间的名单变更永久丢失 |
| P1 | Redis Pub/Sub 是 fire-and-forget：无持久化 / 重试 / ACK / 版本号 | 引擎宕机窗口内变更丢失，除名单外靠 1h TTL 自愈，名单需重启 |
| P1 | 本地缓存 `maximumSize=64`，且 key 混杂 modelId 与 activationId | 合计超过 64 会 LRU 淘汰热点、频繁回源 MySQL |
| P2 | 抽象未命中前置脚本时指标值填 `-1`（不是 0） | 规则里写 `<=` 类条件可能误判 |
| P2 | Groovy 脚本异常被静默当作"未命中" | 脚本写错表现为"没触发"，不报错 |
| P2 | `median` / `variance` 聚合把整窗数据拉回 JVM | 大窗口下有 OOM 与长尾风险 |
| P2 | `engine_activation.BOTTOM` 取出后全程未使用（死代码） | 写"BOTTOM 决定 pass"是错的 |
| P2 | `DataListsServiceImpl.init()` 裸起线程、无异常处理 | 名单加载失败静默，后续 onMessage 可能 NPE |
| P3 | `ValidateType` 里 LENGTH / MAX_LENGTH / MIN_LENGTH 的 key 同为 11 | 长度类校验无法区分，只能写脚本 |

## 7. 一句话总结

核心机制是"**推失效 + 懒加载**"：Admin 改配置 → Redis Pub/Sub 广播失效 → 引擎本地 Caffeine 缓存失效 → 下一次请求才回源 MySQL 重算；加一个例外：名单是"启动时预加载 + 收到即直写增量更新"。理解这两条，其余分支都能推出来。
