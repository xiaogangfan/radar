# Radar 业务流程与数据流

## 1. 业务主流程

```mermaid
flowchart LR
    C[业务方/调用方] -->|POST /services/v1/upload\nmodelGuid reqId jsonInfo| API[Engine API]
    API --> M[(MySQL\nengine_model)]
    M --> V{模型存在且已激活?}
    V -- 否 --> R0[返回错误]
    V -- 是 --> F[字段校验\nengine_field]
    F --> P[预处理插件\nengine_pre_item]
    P --> E[(MongoDB\nentity_{modelId})]
    E --> A[反欺诈分析引擎]
    A --> AB[Abstraction\n统计/聚合]
    AB --> AD[Adaptation\n插件/特征适配]
    AD --> AC[Activation\n规则计算与命中]
    AC --> CFG[(MySQL\nengine_abstraction\nengine_activation\nengine_rule)]
    AC --> CACHE[(Redis\n结果缓存/配置发布订阅)]
    AC --> ES[(Elasticsearch\n模型索引/命中明细)]
    CACHE --> RESP[返回 CommonResult\n或 GET /getScore 查询]
    RESP --> C
    AC --> LOG[异步结果记录]
    LOG --> MongoLog[(MongoDB 事件上下文)]
    C -->|POST /syncStatus| S[状态同步]
    S --> E
```

关键路径：事件进入 Engine 后先读取模型元数据；可选字段校验通过后，按 `engine_pre_item` 执行插件预处理并写入 MongoDB；随后执行抽象、适配、激活三阶段规则计算，将结果写入 Redis，事件与命中上下文异步送入后续分析链路，最终同步返回风控结果。

## 2. 关系数据库表结构与数据流

```mermaid
erDiagram
    engine_model ||--o{ engine_field : "配置字段"
    engine_model ||--o{ engine_pre_item : "配置预处理"
    engine_model ||--o{ engine_abstraction : "配置抽象"
    engine_model ||--o{ engine_activation : "配置激活"
    engine_model ||--o{ engine_data_lists : "拥有名单"
    engine_activation ||--o{ engine_rule : "包含规则"
    engine_rule ||--o{ engine_rule_history : "版本历史"
    engine_data_lists ||--o{ engine_data_list_meta : "字段元数据"
    engine_data_lists ||--o{ engine_data_list_records : "名单记录"
    users ||--o{ engine_rule_history : "操作人/商户编码"
    engine_model {
      bigint ID PK
      varchar GUID UK
      varchar MODEL_NAME
      varchar ENTITY_NAME
      varchar ENTRY_NAME
      varchar REFERENCE_DATE
      tinyint FIELD_VALIDATE
      int STATUS
    }
    engine_field { bigint ID PK; bigint MODEL_ID FK; varchar FIELD_NAME; varchar FIELD_TYPE; varchar VALIDATE_TYPE; tinyint INDEXED }
    engine_pre_item { bigint ID PK; bigint MODEL_ID FK; varchar SOURCE_FIELD; varchar DEST_FIELD; varchar PLUGIN; int STATUS }
    engine_abstraction { bigint ID PK; bigint MODEL_ID FK; varchar NAME; int AGGREGATE_TYPE; varchar SEARCH_FIELD; varchar FUNCTION_FIELD; int STATUS }
    engine_activation { bigint ID PK; bigint MODEL_ID FK; varchar ACTIVATION_NAME; int BOTTOM; int MEDIAN; int HIGH; int STATUS }
    engine_rule { bigint ID PK; bigint MODEL_ID FK; bigint ACTIVATION_ID FK; varchar ABSTRACTION_NAME; int INIT_SCORE; int RATE; int MAX; int STATUS }
    engine_rule_history { bigint ID PK; bigint RULE_ID FK; varchar MERCHANT_CODE; varchar RULE_DEFINITION; datetime UPDATE_TIME }
    engine_data_lists { bigint ID PK; bigint MODEL_ID FK; varchar NAME; varchar LIST_TYPE; int STATUS }
    engine_data_list_meta { bigint ID PK; bigint DATA_LIST_ID FK; varchar FIELD_NAME; int SEQ_NUM }
    engine_data_list_records { bigint ID PK; bigint DATA_LIST_ID FK; varchar DATA_RECORD; varchar DATA_REMARK }
    users { bigint ID PK; varchar CODE; varchar STATUS }
```

## 3. 非关系数据存储

- MongoDB：按模型写入 `entity_{modelId}` 集合，保存原始事件字段、预处理字段、`radar_ref_datetime` 和 `status`；用于事件去重、状态更新及统计计算。
- Redis：缓存 `modelGuid + reqId` 对应的分析结果，并通过发布订阅通知 Engine 刷新模型、规则等本地缓存。
- Elasticsearch：按模型建立索引，保存事件检索字段与规则命中明细，用于查询和命中报表。

## 4. 版本说明

`sql/radar-init.sql` 是基础初始化脚本；`sql/radar-1.0.8.sql` 追加 `engine_rule.MAX` 和 `engine_data_list_records.DATA_REMARK`。本地 Compose 已将两者按“初始化 + 升级”顺序处理，其中升级脚本需在初始化完成后执行。
