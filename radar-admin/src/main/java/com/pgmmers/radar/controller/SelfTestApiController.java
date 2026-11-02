package com.pgmmers.radar.controller;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.pgmmers.radar.enums.FieldType;
import com.pgmmers.radar.enums.StatusType;
import com.pgmmers.radar.service.common.CommonResult;
import com.pgmmers.radar.service.model.FieldService;
import com.pgmmers.radar.service.model.ModelService;
import com.pgmmers.radar.vo.model.FieldVO;
import com.pgmmers.radar.vo.model.ModelVO;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 模型自测：按模型字段定义构造一份"真实有效"的事件参数，
 * 代理调用引擎 /services/v1/upload，并把引擎原始返回结果回给前端展示。
 *
 * <p>只在 admin 侧存在，不改动引擎与任何既有接口契约。</p>
 */
@RestController
@RequestMapping("/services/v1/model/selfTest")
@Api(value = "SelfTestApi", description = "模型列表自测：构造参数并调用引擎", tags = {"模型自测API"})
public class SelfTestApiController {

    public static final Logger logger = LoggerFactory.getLogger(SelfTestApiController.class);

    /**
     * 三种自测场景。除 eventId/reqId 每次必变外，其余"身份类"取值按 modelId+scenario
     * 做确定性哈希，保证连点多次时同一身份会累积命中滑窗指标。
     */
    private static final String SCENARIO_NEW = "new";                 // 全新：IP/设备/账号都换
    private static final String SCENARIO_SAME_DEVICE = "sameDevice";  // 同一设备重复提交
    private static final String SCENARIO_SAME_IP = "sameIp";          // 同一 IP 换设备

    /** 国内 IP 段：用国内地址构造，避免误命中"IP 归属地国外"类模板规则 */
    private static final String[] CN_IPS = {"114.114.114.114", "223.5.5.5", "119.29.29.29", "180.101.49.11"};
    private static final String[] OSS = {"Android", "iOS"};
    private static final String[] CHANNELS = {"app", "web", "h5"};

    @Value("${sys.conf.engine-url:http://127.0.0.1:6581}")
    private String engineUrl;

    @Autowired
    private ModelService modelService;

    @Autowired
    private FieldService fieldService;

    @Autowired
    private RestTemplate restTemplate;

    /**
     * 生成一份可以直接提交的示例参数。
     */
    @GetMapping("/params/{id}")
    @ApiOperation(value = "按模型字段构造自测参数")
    public CommonResult params(@PathVariable Long id,
                               @RequestParam(value = "scenario", defaultValue = SCENARIO_NEW) String scenario) {
        CommonResult result = new CommonResult();
        ModelVO model = modelService.getModelById(id);
        if (model == null) {
            result.setSuccess(false);
            result.setMsg("模型不存在：id=" + id);
            return result;
        }

        JSONObject jsonInfo = buildJsonInfo(id, scenario, model.getReferenceDate());

        result.setSuccess(true);
        result.getData().put("modelId", id);
        result.getData().put("modelName", model.getLabel() == null ? model.getModelName() : model.getLabel());
        result.getData().put("guid", model.getGuid());
        result.getData().put("referenceDate", model.getReferenceDate());
        result.getData().put("entryName", model.getEntryName());
        result.getData().put("jsonInfo", jsonInfo);
        result.getData().put("scenarios", scenarios());
        List<FieldVO> fields = fieldService.listField(id);
        String refField = model.getReferenceDate();
        boolean refMissing = refField != null && !refField.isEmpty() && !hasField(fields, refField);
        if (fields.isEmpty()) {
            result.getData().put("warn", "该模型还没有定义字段，自测参数为空；请先在「字段」里配置后再自测。");
        } else if (refMissing) {
            result.getData().put("warn", "模型的参考时间字段 " + refField + " 没有定义在字段里，自测已自动补上该字段；"
                    + "建议在「字段管理」补上它并重新构建模型，否则业务上报时缺这个字段引擎会直接报错。");
        } else if (model.getStatus() == null || model.getStatus() != StatusType.ACTIVE.getKey()) {
            result.getData().put("warn", "模型当前不是激活状态，引擎会直接拒绝请求，请先激活模型。");
        }
        return result;
    }

    /**
     * 执行一次自测：POST 引擎的 /services/v1/upload。
     * body 里给了 jsonInfo 就以前端（用户可能手工改过）的为准，否则按 scenario 重新构造。
     */
    @PostMapping("/run")
    @ApiOperation(value = "执行一次自测调用")
    public CommonResult run(@RequestBody JSONObject body) {
        CommonResult result = new CommonResult();
        Long modelId = body.getLong("modelId");
        String scenario = body.getString("scenario");
        if (scenario == null || scenario.isEmpty()) {
            scenario = SCENARIO_NEW;
        }
        ModelVO model = modelService.getModelById(modelId);
        if (model == null) {
            result.setSuccess(false);
            result.setMsg("模型不存在：id=" + modelId);
            return result;
        }

        JSONObject jsonInfo = body.getJSONObject("jsonInfo");
        if (jsonInfo == null || jsonInfo.isEmpty()) {
            jsonInfo = buildJsonInfo(modelId, scenario, model.getReferenceDate());
        }

        // 引擎落库时无条件 doc.getLong(referenceDate)，缺这个字段会直接 NPE(400)；
        // 另外去重键 entryName 缺值时 {entry:null} 会把所有事件判成同一条，只落第一条。
        // 用户手工改参数时很容易把这两个字段删掉，这里统一兜底补上。
        List<String> autoFilled = new ArrayList<>();
        String refField = model.getReferenceDate();
        if (refField != null && !refField.isEmpty() && !jsonInfo.containsKey(refField)) {
            jsonInfo.put(refField, System.currentTimeMillis());
            autoFilled.add(refField);
        }
        String entryField = model.getEntryName();
        if (entryField != null && !entryField.isEmpty() && !jsonInfo.containsKey(entryField)) {
            jsonInfo.put(entryField, "evt-" + System.currentTimeMillis() + "-" + randomToken(4));
            autoFilled.add(entryField);
        }

        JSONObject req = new JSONObject(true);
        req.put("guid", model.getGuid());
        req.put("reqId", "selftest-" + System.currentTimeMillis() + "-" + randomToken(4));
        req.put("jsonInfo", jsonInfo);

        String url = engineUrl.trim() + "/services/v1/upload";
        long start = System.currentTimeMillis();
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<String> entity = new HttpEntity<>(req.toJSONString(), headers);
            ResponseEntity<String> resp = restTemplate.postForEntity(url, entity, String.class);
            long cost = System.currentTimeMillis() - start;

            String raw = resp.getBody();
            JSONObject engineResult = null;
            try {
                engineResult = JSON.parseObject(raw);
            } catch (Exception e) {
                logger.warn("引擎返回非 JSON：{}", raw);
            }

            result.setSuccess(true);
            result.getData().put("engineUrl", url);
            result.getData().put("costMs", cost);
            result.getData().put("httpStatus", resp.getStatusCodeValue());
            result.getData().put("request", req);
            if (!autoFilled.isEmpty()) {
                result.getData().put("autoFilled", String.join(",", autoFilled));
            }
            result.getData().put("response", engineResult == null ? raw : engineResult);
            if (engineResult != null) {
                result.getData().put("summary", summary(model.getReferenceDate(), jsonInfo, engineResult));
            }
        } catch (RestClientException e) {
            logger.error("调用引擎失败 url={}", url, e);
            result.setSuccess(false);
            result.getData().put("engineUrl", url);
            result.getData().put("costMs", System.currentTimeMillis() - start);
            result.getData().put("request", req);
            String detail;
            if (e instanceof HttpStatusCodeException) {
                // 引擎的 4xx/5xx 正文才是真正原因（如"事件缺少参考时间字段[...]"）
                detail = ((HttpStatusCodeException) e).getResponseBodyAsString();
            } else {
                detail = e.getMessage() + "；请确认引擎已启动且 sys.conf.engine-url 配置正确";
            }
            result.setMsg("调用引擎失败（" + url + "）：" + detail);
        }
        return result;
    }

    /** 把引擎返回压成一句话结论，方便弹窗顶部直接看 */
    private static JSONObject summary(String refDateField, JSONObject jsonInfo, JSONObject engineResult) {
        JSONObject s = new JSONObject(true);
        s.put("success", engineResult.getBooleanValue("success"));
        s.put("msg", engineResult.getString("msg"));
        s.put("code", engineResult.getString("code"));
        JSONObject acts = engineResult.getJSONObject("activations");
        if (acts != null && !acts.isEmpty()) {
            StringBuilder risk = new StringBuilder();
            for (Map.Entry<String, Object> e : acts.entrySet()) {
                Object v = e.getValue();
                if (!(v instanceof JSONObject)) {
                    continue;
                }
                JSONObject act = (JSONObject) v;
                if (risk.length() > 0) {
                    risk.append(" | ");
                }
                risk.append(e.getKey()).append('=').append(act.getString("risk")).append('/').append(act.getIntValue("score"));
            }
            s.put("activations", risk.toString());
        }
        JSONObject hits = engineResult.getJSONObject("hitsDetail");
        if (hits != null) {
            int total = 0;
            for (Map.Entry<String, Object> e : hits.entrySet()) {
                Object v = e.getValue();
                if (v instanceof com.alibaba.fastjson.JSONArray) {
                    total += ((com.alibaba.fastjson.JSONArray) v).size();
                }
            }
            s.put("hitCount", total);
            s.put("hitsDetail", hits);
        }
        JSONObject abstractions = engineResult.getJSONObject("abstractions");
        if (abstractions != null) {
            s.put("abstractions", abstractions);
        }
        if (refDateField != null) {
            s.put("referenceDate", jsonInfo.get(refDateField));
        }
        return s;
    }

    /**
     * 按模型字段定义构造事件体。字段名相识度优先（mobile/ip/deviceId...），其次按类型兜底。
     */
    private JSONObject buildJsonInfo(Long modelId, String scenario, String referenceDate) {
        List<FieldVO> fields = fieldService.listField(modelId);
        JSONObject json = new JSONObject(true);
        for (FieldVO field : fields) {
            String name = field.getFieldName();
            if (name == null) {
                continue;
            }
            Object value;
            if (name.equals(referenceDate)) {
                value = System.currentTimeMillis();
            } else if (isIdLike(name)) {
                // 流水号类每次必 new，避免"重复事件"去重
                value = "evt-" + System.currentTimeMillis() + "-" + randomToken(4);
            } else if (name.toLowerCase().contains("mobile") || name.toLowerCase().contains("phone")) {
                value = mobile(modelId, scenario);
            } else if (name.toLowerCase().contains("ip")) {
                value = ip(modelId, scenario);
            } else if (name.toLowerCase().contains("device") || name.toLowerCase().contains("did")) {
                // 全新 / 同IP换设备：设备每次都不一样；同一设备重复提交：设备固定
                value = SCENARIO_SAME_DEVICE.equals(scenario)
                        ? "dev-" + stable(modelId, scenario, name, 6)
                        : "dev-" + randomToken(6);
            } else if (name.toLowerCase().contains("user") || name.toLowerCase().contains("account")
                    || name.toLowerCase().contains("uid")) {
                // 全新：账号每次都不一样；其余场景账号固定
                value = SCENARIO_NEW.equals(scenario)
                        ? "u-" + randomToken(6)
                        : "u-" + stable(modelId, scenario, name, 6);
            } else if (name.toLowerCase().contains("passwd") || name.toLowerCase().contains("password")) {
                value = randomToken(8);
            } else if (name.toLowerCase().contains("os")) {
                value = OSS[(int) (stableHash(modelId + scenario + name) % OSS.length)];
            } else if (name.toLowerCase().contains("channel")) {
                value = CHANNELS[(int) (stableHash(modelId + scenario + name) % CHANNELS.length)];
            } else if (isTimeLike(name)) {
                value = System.currentTimeMillis();
            } else if (isAmountLike(name)) {
                value = amountValue(field.getFieldType(), modelId, scenario, name);
            } else {
                value = byType(field.getFieldType(), modelId, scenario, name);
            }
            json.put(name, value);
        }
        // 参考时间字段可能没被建模成字段（历史模型常见），但引擎落库强依赖它，必须带上
        if (referenceDate != null && !referenceDate.isEmpty() && !json.containsKey(referenceDate)) {
            json.put(referenceDate, System.currentTimeMillis());
        }
        return json;
    }

    private static final String[] AMOUNT_KEYS = {"jine", "jiner", "amount", "money", "price", "fee", "cost", "balance"};

    private static boolean isAmountLike(String name) {
        String n = name.toLowerCase();
        for (String k : AMOUNT_KEYS) {
            if (n.contains(k)) {
                return true;
            }
        }
        return false;
    }

    private static boolean isTimeLike(String name) {
        String n = name.toLowerCase();
        return n.contains("time") || n.contains("date");
    }

    /** 金额类字段：给一个介于 10 万～25 万的正常交易金额，便于直接命中"大额交易"类规则 */
    private static Object amountValue(String fieldType, Long modelId, String scenario, String name) {
        long v = Math.abs(stableHash(modelId + scenario + name)) % 149999L + 100001L;
        if ("DOUBLE".equals(fieldType)) {
            return (double) v;
        }
        if ("INTEGER".equals(fieldType)) {
            return (int) v;
        }
        if ("LONG".equals(fieldType)) {
            return v;
        }
        return String.valueOf(v);
    }

    private static boolean hasField(List<FieldVO> fields, String fieldName) {
        for (FieldVO f : fields) {
            if (fieldName.equals(f.getFieldName())) {
                return true;
            }
        }
        return false;
    }

    private static Object byType(String fieldType, Long modelId, String scenario, String name) {
        if (fieldType == null) {
            return "st-" + stable(modelId, scenario, name, 6);
        }
        try {
            FieldType type = FieldType.valueOf(fieldType);
            switch (type) {
                case INTEGER:
                    return (int) (stableHash(modelId + scenario + name) % 90) + 10;
                case LONG:
                    return System.currentTimeMillis();
                case DOUBLE:
                    return Math.round((stableHash(modelId + scenario + name) % 10000) / 100.0 * 100.0) / 100.0;
                default:
                    return "st-" + stable(modelId, scenario, name, 6);
            }
        } catch (IllegalArgumentException e) {
            return "st-" + stable(modelId, scenario, name, 6);
        }
    }

    /** 是否"流水号"类：每次请求都要变 */
    private static boolean isIdLike(String name) {
        String n = name.toLowerCase();
        return n.contains("eventid") || n.contains("orderno") || n.contains("orderid")
                || n.contains("tradeid") || n.contains("reqid") || n.contains("requestid")
                || n.contains("transid") || n.contains("serialno");
    }

    private static String mobile(Long modelId, String scenario) {
        String[] prefix = {"138", "139", "150", "186", "199"};
        String p = prefix[(int) Math.abs(stableHash(modelId + "mobile") % prefix.length)];
        if (SCENARIO_NEW.equals(scenario)) {
            return p + String.format("%08d", ThreadLocalRandom.current().nextLong(100000000L));
        }
        return p + String.format("%08d", Math.abs(stableHash(modelId + scenario + "mobile-no") % 100000000L));
    }

    /** 全新场景换 IP；其余场景 IP 按 modelId 稳定取值，便于滑窗累积 */
    private static String ip(Long modelId, String scenario) {
        if (SCENARIO_NEW.equals(scenario)) {
            return CN_IPS[ThreadLocalRandom.current().nextInt(CN_IPS.length)];
        }
        return CN_IPS[(int) Math.abs(stableHash(modelId + scenario + "ip") % CN_IPS.length)];
    }

    /** 稳定串：同一 modelId + scenario + 字段每次得到同一个值，用于跨多次调用的身份固定 */
    private static String stable(Long modelId, String scenario, String name, int len) {
        String hex = Long.toHexString(Math.abs(stableHash(modelId + scenario + name)));
        StringBuilder sb = new StringBuilder(hex);
        while (sb.length() < len) {
            sb.insert(0, '0');
        }
        return sb.substring(0, len);
    }

    private static long stableHash(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] d = md.digest(s.getBytes(StandardCharsets.UTF_8));
            long h = 0;
            for (int i = 0; i < 8; i++) {
                h = (h << 8) | (d[i] & 0xff);
            }
            return h;
        } catch (Exception e) {
            return Math.abs(s.hashCode());
        }
    }

    private static String randomToken(int len) {
        char[] cs = "abcdefghijklmnopqrstuvwxyz0123456789".toCharArray();
        StringBuilder sb = new StringBuilder();
        ThreadLocalRandom r = ThreadLocalRandom.current();
        for (int i = 0; i < len; i++) {
            sb.append(cs[r.nextInt(cs.length)]);
        }
        return sb.toString();
    }

    private static List<Map<String, Object>> scenarios() {
        List<Map<String, Object>> list = new ArrayList<>();
        list.add(scenario(SCENARIO_NEW, "全新请求（推荐首测）",
                "IP / 设备 / 账号都是新的。首次调用通常命中不了滑窗规则，结果多为 pass。"));
        list.add(scenario(SCENARIO_SAME_DEVICE, "同一设备重复提交",
                "固定 IP + 设备 + 账号，每次换事件流水号。用于验证\"同设备/同账号按次数\"累加的规则。"));
        list.add(scenario(SCENARIO_SAME_IP, "同一 IP 换设备（易复现高分）",
                "固定 IP、每次换设备。连点 3 次即可让\"10 分钟内同 IP 关联设备数 ≥3\"这类规则命中。"));
        return list;
    }

    private static Map<String, Object> scenario(String key, String name, String desc) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", key);
        m.put("name", name);
        m.put("desc", desc);
        return m;
    }
}
