package com.pgmmers.radar.enums;

/**
 * 业务线类型.
 * 本期以枚举提供业务线数据，后续公司基础服务统一供给时替换数据源
 * （仅改 GET /dimension/businessLine/list 与 tree() 的实现，接口契约不变）。
 */
public enum BusinessLineType {

    ECOMMERCE("ecommerce", "电商"),
    LOCAL_LIFE("local-life", "本地生活"),
    ERRAND("errand", "跑腿"),
    SOCIAL("social", "社交"),
    MOBILITY("mobility", "出行"),
    HEALTHCARE("healthcare", "大健康"),
    METAVERSE("metaverse", "元宇宙"),
    UNCLASSIFIED("unclassified", "未分类");

    private final String code;
    private final String name;

    BusinessLineType(String code, String name) {
        this.code = code;
        this.name = name;
    }

    public String getCode() {
        return code;
    }

    public String getName() {
        return name;
    }

    /**
     * code -> 枚举，找不到返回 null
     */
    public static BusinessLineType of(String code) {
        if (code == null) {
            return null;
        }
        for (BusinessLineType type : values()) {
            if (type.code.equals(code)) {
                return type;
            }
        }
        return null;
    }
}
