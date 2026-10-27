package com.pgmmers.radar.vo.dimension;

import java.io.Serializable;
import java.util.List;

/**
 * 左树节点：业务线节点（children 为场景节点）
 */
public class BusinessLineTreeVO implements Serializable {

    static final long serialVersionUID = 2340056233L;

    /** 业务线编码（BusinessLineType.code） */
    private String code;

    private String name;

    /** 下属场景数 */
    private Integer sceneCount;

    /** 下属模型数（场景求和；未分类节点为 SCENE_ID IS NULL 计数） */
    private Long modelCount;

    private List<SceneTreeVO> children;

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Integer getSceneCount() {
        return sceneCount;
    }

    public void setSceneCount(Integer sceneCount) {
        this.sceneCount = sceneCount;
    }

    public Long getModelCount() {
        return modelCount;
    }

    public void setModelCount(Long modelCount) {
        this.modelCount = modelCount;
    }

    public List<SceneTreeVO> getChildren() {
        return children;
    }

    public void setChildren(List<SceneTreeVO> children) {
        this.children = children;
    }
}
