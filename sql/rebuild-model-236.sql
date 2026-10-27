-- ============================================================================
-- 重建模型 236「电商-营销防刷-jmeter」
-- 背景：2026-10-10 清理磁盘时删掉了 Docker.raw，UI 手工创建的 6 个模型丢失
--      （init.sql 只 seed 了 99/101/103/222/224 五个），手册示例失效。
-- 做法：以init.sql 自带的 99 号「登录行为模板」为模板（它的 13 个抽象 + 5 条规则
--      与 236 原来的完全同构），复制一份挂到 236，再补上手册新增的
--      抽象 556（log_did_ip_10_min_qty）和规则 442（同 IP 10 分钟关联设备数 ≥3）。
--      ID 与 GUID 沿用手册里写的那两个，手册无需改动。
-- ============================================================================

-- 1) 模型本体：GUID / modelName 沿用手册 §9.2 curl 里那个
INSERT INTO engine_model
  (ID, GUID, MODEL_NAME, LABEL, ENTITY_NAME, ENTRY_NAME, REFERENCE_DATE,
   FIELD_VALIDATE, CODE, BUSINESS_LINE, SCENE_ID, TEMPLATE, DASHBOARD_URL,
   STATUS, CREATE_TIME, UPDATE_TIME)
VALUES
  (236, 'E48E20E0-4B47-4152-B21D-486F1C51500B', 'm_ecom_demo', '电商-营销防刷-jmeter',
   'userId', 'eventId', 'loginTime',
   0, 'pgmmer.top', 'ecommerce', 1, 0, NULL,
   1, '2026-10-08 16:37:23', NOW());

-- 2) 字段：复制 99 的 9 个，按手册 §3 的表格调整索引标记与显示名
INSERT INTO engine_field
  (MODEL_ID, FIELD_NAME, LABEL, FIELD_TYPE, VALIDATE_TYPE, VALIDATE_ARGS, INDEXED, CREATE_TIME, UPDATE_TIME)
SELECT 236, FIELD_NAME, LABEL, FIELD_TYPE, VALIDATE_TYPE, VALIDATE_ARGS, INDEXED, NOW(), NOW()
FROM engine_field WHERE MODEL_ID = 99;

-- 手册 §3：抽象要用到的 userIP / deviceId 必须勾索引；passwd 标注为明文占位
UPDATE engine_field SET INDEXED = 1 WHERE MODEL_ID = 236 AND FIELD_NAME IN ('userIP', 'deviceId');
UPDATE engine_field SET LABEL = '登录密码明文' WHERE MODEL_ID = 236 AND FIELD_NAME = 'passwd';

-- 3) 预处理：手册 §4 的 3 条（IP归属地 / 手机号码归属地 / 手机号码段）
INSERT INTO engine_pre_item
  (MODEL_ID, SOURCE_FIELD, SOURCE_LABEL, DEST_FIELD, LABEL, ARGS, PLUGIN, CONFIG_JSON, REQ_TYPE, STATUS, CREATE_TIME, UPDATE_TIME)
SELECT 236, SOURCE_FIELD, SOURCE_LABEL, DEST_FIELD, LABEL, ARGS, PLUGIN, CONFIG_JSON, REQ_TYPE, STATUS, NOW(), NOW()
FROM engine_pre_item WHERE MODEL_ID = 99;

-- 4) 抽象：先复制 13 条标准指标
INSERT INTO engine_abstraction
  (NAME, LABEL, MODEL_ID, AGGREGATE_TYPE, SEARCH_FIELD, SEARCH_INTERVAL_TYPE,
   SEARCH_INTERVAL_VALUE, FUNCTION_FIELD, RULE_SCRIPT, RULE_DEFINITION, STATUS, COMMENT, CREATE_TIME, UPDATE_TIME)
SELECT NAME, LABEL, 236, AGGREGATE_TYPE, SEARCH_FIELD, SEARCH_INTERVAL_TYPE,
       SEARCH_INTERVAL_VALUE, FUNCTION_FIELD, RULE_SCRIPT, RULE_DEFINITION, 1, COMMENT, NOW(), NOW()
FROM engine_abstraction WHERE MODEL_ID = 99;

-- 4b) 第 14 条：手册 §6 的核心指标，ID 沿用手册写的 556
INSERT INTO engine_abstraction
  (ID, NAME, LABEL, MODEL_ID, AGGREGATE_TYPE, SEARCH_FIELD, SEARCH_INTERVAL_TYPE,
   SEARCH_INTERVAL_VALUE, FUNCTION_FIELD, RULE_SCRIPT, RULE_DEFINITION, STATUS, COMMENT, CREATE_TIME, UPDATE_TIME)
VALUES
  (556, 'log_did_ip_10_min_qty', '10分钟内IP关联设备数', 236, 2, 'fields.userIP', 12,
   10, 'fields.deviceId',
   'class AbstractionCheckScript {\n  public boolean check(def data, def lists) {    if (data.fields.userIP)\n        return true;\n    else\n        return false;\n}}',
   '{"linking":"All","conditions":[{"class":"SMPL","expressions":[{"column":"fields.userIP","type":"STRING","class":"ENTATTR"}],"enabled":true,"operator":"IsNotNull"}],"class":"PDCT","enabled":true}',
   1, '手册示例：同 IP 10 分钟内关联设备数', NOW(), NOW());

-- 5) 策略：手册 §8.1（警戒 40 / 拒绝 80）
INSERT INTO engine_activation
  (ID, ACTIVATION_NAME, LABEL, MODEL_ID, COMMENT, BOTTOM, MEDIAN, HIGH, STATUS, RULE_ORDER, CREATE_TIME, UPDATE_TIME)
VALUES
  (125, 'login_exception', '登录异常', 236, '', 0, 40, 80, 1, '', NOW(), NOW());

-- 6) 规则：先复制 99 的 5 条
INSERT INTO engine_rule
  (MODEL_ID, ACTIVATION_ID, NAME, LABEL, SCRIPTS, INIT_SCORE, BASE_NUM, OPERATOR,
   ABSTRACTION_NAME, RATE, STATUS, RULE_DEFINITION, CREATE_TIME, UPDATE_TIME)
SELECT 236, 125, CONCAT('rule_', ID), LABEL, SCRIPTS, INIT_SCORE, BASE_NUM, OPERATOR,
       ABSTRACTION_NAME, RATE, 1, RULE_DEFINITION, NOW(), NOW()
FROM engine_rule WHERE MODEL_ID = 99;

-- 6b) 第 6 条：手册 §8.2，命中加 100 分（initScore 100 + baseNum 0 × rate）
INSERT INTO engine_rule
  (ID, MODEL_ID, ACTIVATION_ID, NAME, LABEL, SCRIPTS, INIT_SCORE, BASE_NUM, OPERATOR,
   ABSTRACTION_NAME, RATE, STATUS, RULE_DEFINITION, CREATE_TIME, UPDATE_TIME)
VALUES
  (442, 236, 125, 'rule_did_ip_10min_ge3', '10分钟内IP关联设备数大于等于3',
   'class ActivationCheckScript {\n  public boolean check(def data, def lists) {    if (data.abstractions.log_did_ip_10_min_qty>=3)\n        return true;\n    else\n        return false;\n}}',
   100, 0, 'MUL', 'log_did_ip_10_min_qty', 100, 1,
   '{"linking":"All","conditions":[{"class":"SMPL","expressions":[{"column":"abstractions.log_did_ip_10_min_qty","type":"DOUBLE","class":"ENTATTR"},{"type":"DOUBLE","class":"CONST","value":"3"}],"enabled":true,"operator":"Greater_Equal"}],"class":"PDCT","enabled":true}',
   NOW(), NOW());

-- 7) 规则顺序按手册 §8.2 截图里的排列
SET @r1 = (SELECT ID FROM engine_rule WHERE MODEL_ID=236 AND LABEL='1天内IP关联用户数大于10');
SET @r2 = (SELECT ID FROM engine_rule WHERE MODEL_ID=236 AND LABEL='1天内IP关联设备数大于10');
SET @r3 = (SELECT ID FROM engine_rule WHERE MODEL_ID=236 AND LABEL='10分钟内IP登录次数大于10');
SET @r4 = (SELECT ID FROM engine_rule WHERE MODEL_ID=236 AND LABEL='IP登录位置显示国外');
SET @r5 = (SELECT ID FROM engine_rule WHERE MODEL_ID=236 AND LABEL='1天内用户登录次数大于30');
UPDATE engine_activation SET RULE_ORDER = CONCAT(@r1,',',@r2,',',@r3,',',@r4,',',@r5,',442') WHERE ID = 125;