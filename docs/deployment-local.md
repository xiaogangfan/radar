# Radar 本地部署记录

## 已完成

- 使用 JDK 17 + Maven 构建 `radar-admin` 与 `radar-engine`。
- 根 POM 锁定 Lombok `1.18.40`，解决旧版本在 JDK 17/21 下的 `IllegalAccessError`。
- `docker-compose.yml` 已提供 MySQL、MongoDB、Redis、Elasticsearch 基础设施。
- MySQL 已导入 `sql/radar-init.sql`，并执行 `sql/radar-1.0.8.sql` 升级字段。
- MongoDB、Redis、Elasticsearch 已启动。
- Admin 已启动：`http://127.0.0.1:6580/`（HTTP 200）。
- Engine 已启动：`http://127.0.0.1:6581/`；`GET /services/v1/getScore` 已返回业务 JSON（HTTP 200）。

## 启动命令

```bash
docker compose up -d mysql redis elasticsearch mongodb

JAVA_HOME=/opt/homebrew/opt/openjdk@17 mvn -DskipTests \
  -pl radar-admin,radar-engine -am package

JAVA_HOME=/opt/homebrew/opt/openjdk@17 java -jar radar-admin/target/radar-admin.jar \
  --spring.profiles.active=local \
  --mobile.info.path="$PWD/resources/moble_info.csv" \
  --ip2region.db.path="$PWD/resources/ip2region.db" \
  --sys.conf.workdir="$PWD/workdir" \
  --spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.groovy.template.GroovyTemplateAutoConfiguration

JAVA_HOME=/opt/homebrew/opt/openjdk@17 java -jar radar-engine/target/radar-engine.jar \
  --spring.profiles.active=local \
  --mobile.info.path="$PWD/resources/moble_info.csv" \
  --ip2region.db.path="$PWD/resources/ip2region.db" \
  --sys.conf.workdir="$PWD/workdir" \
  --spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.groovy.template.GroovyTemplateAutoConfiguration
```

## 验证结果

- `docker compose ps`：MySQL、MongoDB、Redis、Elasticsearch 均为运行状态，MySQL 健康检查通过。
- MongoDB：`db.runCommand({ping: 1})` 返回 `1`。
- Admin 首页：`GET /` 返回 HTTP 200。
- Engine：`GET /services/v1/getScore?modelGuid=test&reqId=test` 返回 HTTP 200 和预期的业务响应 `601 / reqId 已经过期`。

初始示例模型处于未激活状态；配置模型、构建索引并激活后即可调用 `/services/v1/upload` 执行完整风控分析。
