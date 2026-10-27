package com.pgmmers.radar.dal.bean;

public class ModelQuery extends PageQuery {

	private String modelName;
	private Integer status;
	private String merchantCode;
	private String label;
	private String businessLine;
	private Long sceneId;
	private Boolean onlyUnclassified;

	public Boolean getOnlyUnclassified() {
		return onlyUnclassified;
	}

	public void setOnlyUnclassified(Boolean onlyUnclassified) {
		this.onlyUnclassified = onlyUnclassified;
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

	public String getModelName() {
		return modelName;
	}

	public void setModelName(String modelName) {
		this.modelName = modelName;
	}

	public Integer getStatus() {
		return status;
	}

	public void setStatus(Integer status) {
		this.status = status;
	}

	public String getMerchantCode() {
		return merchantCode;
	}

	public void setMerchantCode(String merchantCode) {
		this.merchantCode = merchantCode;
	}

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }


}
