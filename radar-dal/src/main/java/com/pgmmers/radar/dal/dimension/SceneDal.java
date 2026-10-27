package com.pgmmers.radar.dal.dimension;

import com.pgmmers.radar.model.ScenePO;

import java.util.List;
import java.util.Map;

public interface SceneDal {

    /**
     * 按业务线查场景列表（按 SORT,ID 升序）
     *
     * @param businessLine 业务线编码，null 查全部
     * @param status       状态过滤，null 查全部
     */
    List<ScenePO> listByBusinessLine(String businessLine, Integer status);

    /**
     * 全量场景（树/计数用）
     */
    List<ScenePO> listAll();

    ScenePO getById(Long id);

    /**
     * id 为空走 insertSelective，否则 updateByPrimaryKeySelective
     */
    int save(ScenePO po);

    int delete(Long id);

    /**
     * CODE 全局唯一校验用
     */
    ScenePO getByCode(String code);

    /**
     * 删除校验：该场景下模型数（查 engine_model）
     */
    long countModel(Long sceneId);

    /**
     * 树节点计数：sceneId -> modelCount
     */
    Map<Long, Long> countModelGroupByScene();

    /**
     * engine_model 中 SCENE_ID IS NULL 的数量（未分类节点计数）
     */
    long countUnclassified();

    /**
     * 列表补名用
     */
    List<ScenePO> listByIds(List<Long> ids);
}
