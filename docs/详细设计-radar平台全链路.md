# 详细设计：Radar 平台全链路（配置模型 → 引擎计算 → 结果回写）

关联：`docs/方案-radar平台全链路详细设计.md`（方法、范围、已知缺口）
已有：`docs/radar-data-flow.md`（概览版，本文为展开版）

> 全文所有实现类/方法/行号均取自当前仓库源码；第 11 节列出调研中发现的反直觉点与缺口，读代码前建议先看。

---

## 1. 总体架构

两个 Java 进程 + 四类存储。关键点是：**`radar-service-impl` 被两端共用**，配置热推与本地缓存都在这一层，所以 Admin 也会订阅自己发的消息（无害但浪费一点内存）。

```mermaid
图表: flowchart LR
  UI[业务方/调用方] -->|POST /services/v1/upload| ENG[radar-engine:6581]
  ADMIN[radar-admin:6580] -->|读配置| MYSQL[(MySQL\n配置表)]
  ADMIN -->|Redis Pub/Sub\n8 个 radar_channel_*| REDIS[(Redis\n结果缓存/发布订阅)]
  REDIS -->|失效通知| ENG
  ENG -->|懒加载回源| MYSQL
  ENG -->|1 写事件| MONGO[(MongoDB\nentity_{modelId})]
  ENG -->|2 读滑窗统计| MONGO
  ENG -->|3 结果缓存 set| REDIS
  ENG -->|4 异步归档| ES[(Elasticsearch\nmodelGuid 小写索引+n't)]
  UI -->|GET /getScore| ENG
  ES -->|事件/命中报表| ADMIN
  MONGO -->|事件查询| ADMIN
```

| 角色 | 模块 | 端口 | 职责 |
|---|---|---|---|
| 配置端 | `radar-admin` | 6580 | 模型/字段/预处理/名单/抽象/规则/策略的 CRUD，构建 Mongo 索引与 ES 索引，改完发 Redis 通知 |
| 决策端 | `radar-engine` | 6581 | 接收事件、保存事件、算抽象滑窗、跑规则与策略、返回结果并落地 |
| 公共层 | `radar-service` / `radar-service-impl` | — | Service、本地缓存、Redis 发布订阅、Groovy 脚本执行器、Mongo/ES 访问 |
| 数据层 | `radar-dao` / `radar-dal` | — | MyBatis PO/Mapping（MBG 产出，只有 resultMap）、DAL 实现与枚举 |

依赖方向：`radar-engine` → `radar-service-impl` → `radar-dal` → `radar-dao`。`radar-engine` 的启动类在根包 `com.pgmmers.radar`，因此会扫描到 `com.pgmmers.radar.service.impl.*` 的所有订阅 Bean。

## 2. 进程与关键配置（local profile）

`radar-admin/src/main/resources/application-local.yml` 与 `radar-engine/src/main/resources/application-local.yml` 中间件地址一致，只有端口与 `sys.conf.app` 不同。

| 配置 | admin | engine | 说明 |
|---|---|---|---|
| `server.port` | 6580 | 6581 | HTTP 端口 |
| MySQL | `jdbc:mysql://127.0.0.1:3306/radar` | 同 | 库 `radar`，GMT+8，无 SSL |
| MongoDB | `mongodb://localhost:27017/radar` | 同 | 库 `radar` |
| Redis | `127.0.0.1`，**database: 1** | 同 | 注意不是 db0（踩过坑：验证码/频道 key 都在 db1） |
| Elasticsearch | `elasticsearch.url=http://127.0.0.1:9200` | 同 | 由 `EsConfig` 读取；yml 里另有旧的 TCP `ip/port:9300` 配置，**已废弃不生效** |
| `entity-duplicate-insert` | false | false | false = 同一 eventId 重复提交只保留第一条（幂等去重） |
| `mongo-restore-days` | 3650 | 3650 | Mongo TTL 索引天数 |
| `machine-learning` | — | true | 引擎侧开启后才走 `Estimator` |
| 数据文件 | `resources/ip2region.db`、`resources/moble_info.csv` | 同 | 手机号归属地与 IP 归属地，预处理插件用 |
| `sys.conf.workdir` | `./workdir` | 同 | 运行目录 |

公共项（`application.yml`）：Druid 连接池 initial-size 8 / max-active 20；MyBatis `mapper-locations: classpath*:mapping/*.xml`；tk.mybatis 通用 Mapper；Redis Lettuce 连接池 max-active 30 / max-idle 10。

> 部署命令与参数见 `docs/deployment-local.md`。注意 jwt token 存在浏览器的 `localStorage["x-auth-token"]`，登录接口需要验证码（验证码 key 在 Redis db1，前缀 `log_captcha_`，120 秒过期）——用脚本登录时要注入同一个 db。

## 3. Admin 配置侧

### 3.1 Controller 清单

全部在 `radar-admin/src/main/java/com/pgmmers/radar/controller/`：

| Controller | 前缀 | 主要 URL |
|---|---|---|
| `ModelApiController` | `/services/v1/model` | `GET /{id}`、`GET /list`、`PUT`(save)、`DELETE`、`POST /build/{id}`、`POST /enable`、`POST /disable`、`POST /copy`、`GET /list/template` |
| `FieldApiController` | `/services/v1/field` | `GET /list/{modelId}`、`PUT`、`DELETE` |
| `PreItemApiController` | `/services/v1/preitem` | `GET /list/{modelId}`、`PUT`、`DELETE` |
| `AbstractionApiController` | `/services/v1/abstraction` | `GET /list/{modelId}`、`GET /datacolumns/{modelId}`、`PUT`、`DELETE` |
| `ActivationApiController` | `/services/v1/activation` | `GET /rule/columns/{modelId}`、`PUT`、`DELETE`、`POST /updateOrder`、`POST /enable|disable/{id}`、`POST /copy` |
| `RuleApiController` | `/services/v1/rule` | `GET /{id}`、`PUT`、`DELETE`、`POST /hitsSort/{modelId}`、`GET /ruleHistory` |
| `DataListApiController` | `/services/v1/datalist` | `GET /list/{modelId}`、`PUT`、`DELETE`、`POST /batchImportData`（Excel） |
| `DataListRecordApiController` | `/services/v1/datalistrecord` | `PUT`(saveRecord)、`DELETE`、`POST /batchImportDataRecord` |
| `DataListMetaApiController` | `/services/v1/datalistmeta` | 名单字段元数据 CRUD（**不发布通知**） |
| `DimensionApiController` | `/services/v1/dimension` | `GET /tree`、`GET /businessLine/list`、`GET /scene/list/{businessLine}` |
| `EventApiController` | 事件查询 | 从 ES / Mongo 查历史事件与命中明细 |
| `UserApiController` / `CommonApiController` | 登录登出、验证码、上传 | 无关热推 |

> 注：后台 UI 与这些接口的对应关系、字段含义的可操作说明见管理后台内置操作手册（`radar-admin/src/main/resources/static/manual.html`，页面右上角「使用手册」）。

### 3.2 发布点在 Service，不在 Controller

容易写错的一点：**发布动作藏在 Service 实现里**，Controller 只调 `save/delete`。发布时机统一是"写库成功、`count > 0` 之后"。共 23 处，均在 `radar-service-impl`：

| Service（`model` 包） | 方法 | 频道 | payload |
|---|---|---|---|
| `ModelServiceImpl` | `save` / `delete` / `build` / `copy` | `radar_channel_model` | ModelVO（含 GUID、ES 索引信息） |
| `FieldServiceImpl` | `save` / `delete` | `radar_channel_field` | FieldVO（含 modelId） |
| `PreItemServiceImpl` | `save` / `delete` | `radar_channel_preitem` | PreItemVO |
| `AbstractionServiceImpl` | `save` / `delete` | `radar_channel_abstraction` | AbstractionVO |
| `ActivationServiceImpl` | `save` / `delete` / `updateOrder` | `radar_channel_activation` | ActivationVO |
| `RuleServiceImpl` | `save` / `delete` | `radar_channel_rule` | RuleVO（含 activationId） |
| `DataListsServiceImpl` | `save` / `delete` / `batchImportData` | `radar_channel_datalist` | DataListsVO + `opt`（new/delete） |
| `DataListsServiceImpl` / `DataListRecordServiceImpl` | `saveRecord` / `deleteRecord` / 批量 | `radar_channel_listrecord` | DataListRecordVO + `opt` + 回填的 `modelId` |

两个已知的**不发布**缺口（P0，见第 11 节）：策略启停 `updateStatus`、名单字段保存 `saveMeta/deleteMeta`。

## 4. 配置热推：为什么不用重启

### 4.1 八个频道与两种刷新策略

频道常量集中在 `radar-service-impl/.../cache/CacheServiceImpl`（第 26–36 行）：

| 常量 | 频道值 | 订阅者 | 刷新策略 |
|---|---|---|---|
| `PUB_SUB_MODEL_CHANNEL` | `radar_channel_model` | `ModelServiceImpl.onMessage` | **失效**（Caffeine invalidate） |
| `PUB_SUB_FIELD_CHANNEL` | `radar_channel_field` | `FieldServiceImpl.onMessage` | 失效 |
| `PUB_SUB_PREITEM_CHANNEL` | `radar_channel_preitem` | `PreItemServiceImpl.onMessage` | 失效 |
| `PUB_SUB_ABSTRACTION_CHANNEL` | `radar_channel_abstraction` | `AbstractionServiceImpl.onMessage` | 失效 |
| `PUB_SUB_RULE_CHANNEL` | `radar_channel_rule` | `RuleServiceImpl.onMessage` | 失效 |
| `PUB_SUB_ACTIVATION_CHANNEL` | `radar_channel_activation` | `ActivationServiceImpl.onMessage` | 失效 |
| `PUB_SUB_DATALIST_CHANNEL` | `radar_channel_datalist` | `DataListsServiceImpl.onMessage` | **直写增量** |
| `PUB_SUB_LISTRECORD_CHANNEL` | `radar_channel_listrecord` | `DataListRecordServiceImpl.onMessage` | **直写增量** |

payload 是 VO 的**全量 JSON**（`JSON.toJSONString(vo)`），没有 envelope、没有版本号：动作语义靠 `opt` 字段或"整个 key 失效"来表达。

### 4.2 订阅方式：不是 `RedisMessageListenerContainer`

```
@PostConstruct → cacheService.subscribeXxx(this)
   → RedisTemplateServiceImpl#subscribe
   → redisTemplate.getConnectionFactory().getConnection()
       .subscribe(MessageListener, channel.getBytes())     // Lettuce，走 Netty EventLoop
```

连接工厂是 Lettuce（非 Jedis），所以 `getConnection().subscribe(...)` 不会阻塞容器主线程。`onMessage` 回调在 Netty 线程上同步执行，但动作只是 `Caffeine#invalidate`（O(1)）或一次 HashMap put/remove，代价很小。

真正的"加载"被推迟到业务线程：下次请求 `localCache.get(key)` 发现 miss，才同步回源 MySQL。这就是"**推失效 + 懒加载**"，而不是"推数据 + 全量预热"。

### 4.3 本地缓存容器

`radar-service-impl/.../model/BaseLocalCacheService`：

- **Caffeine `LoadingCache<Long, Object>`**，`maximumSize=64`、`expireAfterAccess=1 小时`；模板方法 `query(Long)` 由子类回 MySQL。
- key 语义：Model / Field / PreItem / Abstraction / Activation 用 **modelId**；Rule 用 **activationId**（规则按策略集分组缓存）。
- 名单不走 Caffeine，是 `DataListsServiceImpl` 里的静态 `Map<Long modelId, Map<String listName, Map<String 值, "">>>`。

启动时：
- `DataListsServiceImpl.init()`：`@PostConstruct` 里**裸起一个线程**全量预加载名单（并把 **modelId=1 的系统名单合并进每个模型**），异步执行、不保证 Ready 时已完成，无异常处理。
- `ModelServiceImpl.init()`：只预加载 `guidMap`（guid → modelId，普通 HashMap，非线程安全）。
- 其余：只有 `subscribe` 一行，全部懒加载。

### 4.4 自愈上限

没有定时任务轮询 MySQL 兜底。兜底靠：

1. **Caffeine TTL / 访问过期 1 小时** —— 即使 Redis 消息丢失，最多 1 小时后自然过期、下次请求回源。**这是除名单外的最终自愈上限。**
2. **guid 懒加载** —— `getModelByGuid` 查不到就直接查库并回填 `guidMap`，所以 Admin 新建的模型引擎侧不靠消息也能自愈。
3. **名单没有这条兜底** —— 静态 Map 既不过期也不回源，一旦漏掉通知就会偏离 DB，直到重启。

Redis Pub/Sub 本身是 fire-and-forget：无持久化、无重试、无 ACK、无版本号，引擎宕机窗口内的变更永久丢失（名单需重启，其余靠 TTL 自愈）。
