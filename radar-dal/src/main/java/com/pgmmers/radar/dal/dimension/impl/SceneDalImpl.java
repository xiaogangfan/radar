package com.pgmmers.radar.dal.dimension.impl;

import com.pgmmers.radar.dal.dimension.SceneDal;
import com.pgmmers.radar.mapper.ModelMapper;
import com.pgmmers.radar.mapper.SceneMapper;
import com.pgmmers.radar.model.ModelPO;
import com.pgmmers.radar.model.ScenePO;
import org.apache.commons.collections4.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import tk.mybatis.mapper.entity.Example;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class SceneDalImpl implements SceneDal {

    public static Logger logger = LoggerFactory.getLogger(SceneDalImpl.class);

    @Autowired
    private SceneMapper sceneMapper;

    @Autowired
    private ModelMapper modelMapper;

    @Override
    public List<ScenePO> listByBusinessLine(String businessLine, Integer status) {
        Example example = new Example(ScenePO.class);
        Example.Criteria criteria = example.createCriteria();
        if (businessLine != null) {
            criteria.andEqualTo("businessLine", businessLine);
        }
        if (status != null) {
            criteria.andEqualTo("status", status);
        }
        example.setOrderByClause("SORT asc, ID asc");
        List<ScenePO> list = sceneMapper.selectByExample(example);
        if (CollectionUtils.isEmpty(list)) {
            return new ArrayList<>();
        }
        return list;
    }

    @Override
    public List<ScenePO> listAll() {
        return listByBusinessLine(null, null);
    }

    @Override
    public ScenePO getById(Long id) {
        return sceneMapper.selectByPrimaryKey(id);
    }

    @Override
    public int save(ScenePO po) {
        Date sysDate = new Date();
        if (po.getId() == null) {
            po.setCreateTime(sysDate);
            po.setUpdateTime(sysDate);
            return sceneMapper.insertSelective(po);
        }
        po.setUpdateTime(sysDate);
        return sceneMapper.updateByPrimaryKeySelective(po);
    }

    @Override
    public int delete(Long id) {
        return sceneMapper.deleteByPrimaryKey(id);
    }

    @Override
    public ScenePO getByCode(String code) {
        Example example = new Example(ScenePO.class);
        example.createCriteria().andEqualTo("code", code);
        List<ScenePO> list = sceneMapper.selectByExample(example);
        if (CollectionUtils.isEmpty(list)) {
            return null;
        }
        return list.get(0);
    }

    @Override
    public long countModel(Long sceneId) {
        Example example = new Example(ModelPO.class);
        example.createCriteria().andEqualTo("sceneId", sceneId);
        return modelMapper.selectCountByExample(example);
    }

    @Override
    public Map<Long, Long> countModelGroupByScene() {
        Map<Long, Long> result = new HashMap<>();
        // 配置表量级小，全量查回内存分组（selectProperties 单列查询在 tk.mybatis 下会返回 null 元素，勿用）
        Example example = new Example(ModelPO.class);
        List<ModelPO> list = modelMapper.selectByExample(example);
        if (CollectionUtils.isEmpty(list)) {
            return result;
        }
        for (ModelPO po : list) {
            if (po.getSceneId() != null) {
                result.merge(po.getSceneId(), 1L, Long::sum);
            }
        }
        return result;
    }

    @Override
    public long countUnclassified() {
        Example example = new Example(ModelPO.class);
        example.createCriteria().andIsNull("sceneId");
        return modelMapper.selectCountByExample(example);
    }

    @Override
    public List<ScenePO> listByIds(List<Long> ids) {
        if (CollectionUtils.isEmpty(ids)) {
            return new ArrayList<>();
        }
        Example example = new Example(ScenePO.class);
        example.createCriteria().andIn("id", ids);
        List<ScenePO> list = sceneMapper.selectByExample(example);
        if (CollectionUtils.isEmpty(list)) {
            return new ArrayList<>();
        }
        return list;
    }
}
