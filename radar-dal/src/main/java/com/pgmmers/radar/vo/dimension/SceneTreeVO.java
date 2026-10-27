package com.pgmmers.radar.vo.dimension;

import java.io.Serializable;

/**
 * 左树节点：场景节点
 */
public class SceneTreeVO implements Serializable {

    static final long serialVersionUID = 2340056234L;

    private Long id;

    private String name;

    private String code;

    /** 1启用 0停用 */
    private Integer status;

    private Integer sort;

    /** 该场景下模型数 */
    private Long modelCount;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }

    public Integer getSort() {
        return sort;
    }

    public void setSort(Integer sort) {
        this.sort = sort;
    }

    public Long getModelCount() {
        return modelCount;
    }

    public void setModelCount(Long modelCount) {
        this.modelCount = modelCount;
    }
}
