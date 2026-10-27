package com.pgmmers.radar.service.dimension;

import com.pgmmers.radar.service.common.CommonResult;
import com.pgmmers.radar.vo.dimension.SceneVO;

public interface DimensionService {

    /**
     * 左树数据：业务线（枚举骨架，未分类置底） -> 场景，带模型计数
     */
    CommonResult tree();

    /**
     * 业务线列表（枚举数据 + 场景数/模型数计数）
     */
    CommonResult listBusinessLine();

    /**
     * 某业务线下场景列表
     */
    CommonResult listScene(String businessLine);

    CommonResult saveScene(SceneVO vo);

    CommonResult deleteScene(Long[] ids);
}
