package com.pgmmers.radar.vo.model;
import java.io.Serializable;
import java.util.Date;

public class ModelVO implements Serializable{

    static final long serialVersionUID = 2340056231L;

    private Long id;


    private String guid;


    private String modelName;

    private String label;

    private String entityName;


    private String entryName;


    private String referenceDate;


    private Integer status;


    private Date createTime;


    private Date updateTime;
    
    private Boolean fieldValidate;

    private String code;

    private Boolean template;

    private String dashboardUrl;

    /** 业务线编码（BusinessLineType.code） */
    private String businessLine;

    /** 场景ID */
    private Long sceneId;

    /** 业务线名称（展示用，Service 层填充） */
    private String businessLineName;

    /** 场景名称（展示用，Service 层填充） */
    private String sceneName;
    
    public Long getId() {
        return id;
    }


    public void setId(Long id) {
        this.id = id;
    }


    public String getGuid() {
        return guid;
    }


    public void setGuid(String guid) {
        this.guid = guid;
    }


    public String getModelName() {
        return modelName;
    }


    public void setModelName(String modelName) {
        this.modelName = modelName;
    }


    public String getEntityName() {
        return entityName;
    }


    public void setEntityName(String entityName) {
        this.entityName = entityName;
    }


    public String getEntryName() {
        return entryName;
    }


    public void setEntryName(String entryName) {
        this.entryName = entryName;
    }


    public String getReferenceDate() {
        return referenceDate;
    }


    public void setReferenceDate(String referenceDate) {
        this.referenceDate = referenceDate;
    }


    public Integer getStatus() {
        return status;
    }


    public void setStatus(Integer status) {
        this.status = status;
    }


    public Date getCreateTime() {
        return createTime;
    }


    public void setCreateTime(Date createTime) {
        this.createTime = createTime;
    }


    public Date getUpdateTime() {
        return updateTime;
    }


    public void setUpdateTime(Date updateTime) {
        this.updateTime = updateTime;
    }


    public Boolean getFieldValidate() {
        return fieldValidate;
    }


    public void setFieldValidate(Boolean fieldValidate) {
        this.fieldValidate = fieldValidate;
    }


    public String getCode() {
        return code;
    }


    public void setCode(String merchantCode) {
        this.code = merchantCode;
    }


    public String getLabel() {
        return label;
    }


    public void setLabel(String label) {
        this.label = label;
    }


    public Boolean getTemplate() {
        return template;
    }


    public void setTemplate(Boolean template) {
        this.template = template;
    }


    public String getDashboardUrl() {
        return dashboardUrl;
    }


    public void setDashboardUrl(String dashboardUrl) {
        this.dashboardUrl = dashboardUrl;
    }

    public String getBusinessLine() {
        return businessLine;
    }

    public void setBusinessLine(String businessLine) {
        this.businessLine = businessLine;
    }

    public Long getSceneId() {
        return sceneId;
    }

    public void setSceneId(Long sceneId) {
        this.sceneId = sceneId;
    }

    public String getBusinessLineName() {
        return businessLineName;
    }

    public void setBusinessLineName(String businessLineName) {
        this.businessLineName = businessLineName;
    }

    public String getSceneName() {
        return sceneName;
    }

    public void setSceneName(String sceneName) {
        this.sceneName = sceneName;
    }


}
