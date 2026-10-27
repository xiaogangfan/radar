package com.pgmmers.radar.service.impl.dimension;

import com.pgmmers.radar.dal.dimension.SceneDal;
import com.pgmmers.radar.enums.BusinessLineType;
import com.pgmmers.radar.model.ScenePO;
import com.pgmmers.radar.service.common.CommonResult;
import com.pgmmers.radar.service.dimension.DimensionService;
import com.pgmmers.radar.vo.dimension.BusinessLineTreeVO;
import com.pgmmers.radar.vo.dimension.SceneTreeVO;
import com.pgmmers.radar.vo.dimension.SceneVO;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

@Service
public class DimensionServiceImpl implements DimensionService {

    public static Logger logger = LoggerFactory.getLogger(DimensionServiceImpl.class);

    private static final Pattern CODE_PATTERN = Pattern.compile("^[a-z0-9-]+$");

    @Autowired
    private SceneDal sceneDal;

    @Override
    public CommonResult tree() {
        List<ScenePO> allScenes = sceneDal.listAll();
        Map<Long, Long> modelCountByScene = sceneDal.countModelGroupByScene();

        Map<String, List<ScenePO>> scenesByLine = new HashMap<>();
        for (ScenePO po : allScenes) {
            scenesByLine.computeIfAbsent(po.getBusinessLine(), k -> new ArrayList<>()).add(po);
        }

        List<BusinessLineTreeVO> tree = new ArrayList<>();
        for (BusinessLineType type : BusinessLineType.values()) {
            BusinessLineTreeVO node = new BusinessLineTreeVO();
            node.setCode(type.getCode());
            node.setName(type.getName());

            List<SceneTreeVO> children = new ArrayList<>();
            long lineModelCount = 0L;
            for (ScenePO po : scenesByLine.getOrDefault(type.getCode(), new ArrayList<>())) {
                SceneTreeVO child = new SceneTreeVO();
                child.setId(po.getId());
                child.setName(po.getName());
                child.setCode(po.getCode());
                child.setStatus(po.getStatus());
                child.setSort(po.getSort());
                Long cnt = modelCountByScene.getOrDefault(po.getId(), 0L);
                child.setModelCount(cnt);
                lineModelCount += cnt;
                children.add(child);
            }
            node.setSceneCount(children.size());
            node.setModelCount(lineModelCount);
            node.setChildren(children);
            tree.add(node);
        }

        // 未分类置底
        tree.sort(Comparator.comparingInt(
                node -> BusinessLineType.UNCLASSIFIED.getCode().equals(node.getCode()) ? 1 : 0));

        // 未分类节点计数 = SCENE_ID IS NULL 的模型数（覆盖兜底场景 pending 的计数口径）
        BusinessLineTreeVO unclassified = tree.stream()
                .filter(n -> BusinessLineType.UNCLASSIFIED.getCode().equals(n.getCode()))
                .findFirst().orElse(null);
        if (unclassified != null) {
            unclassified.setModelCount(sceneDal.countUnclassified());
        }

        CommonResult result = new CommonResult();
        result.setSuccess(true);
        result.getData().put("tree", tree);
        return result;
    }

    @Override
    public CommonResult listBusinessLine() {
        List<ScenePO> allScenes = sceneDal.listAll();
        Map<Long, Long> modelCountByScene = sceneDal.countModelGroupByScene();

        Map<String, Integer> sceneCountByLine = new HashMap<>();
        Map<String, Long> modelCountByLine = new HashMap<>();
        for (ScenePO po : allScenes) {
            sceneCountByLine.merge(po.getBusinessLine(), 1, Integer::sum);
            modelCountByLine.merge(po.getBusinessLine(),
                    modelCountByScene.getOrDefault(po.getId(), 0L), Long::sum);
        }

        List<Map<String, Object>> list = new ArrayList<>();
        Arrays.stream(BusinessLineType.values())
                .sorted(Comparator.comparingInt(
                        t -> BusinessLineType.UNCLASSIFIED == t ? 1 : 0))
                .forEach(type -> {
                    Map<String, Object> item = new HashMap<>();
                    item.put("code", type.getCode());
                    item.put("name", type.getName());
                    item.put("sceneCount", sceneCountByLine.getOrDefault(type.getCode(), 0));
                    item.put("modelCount", modelCountByLine.getOrDefault(type.getCode(), 0L));
                    list.add(item);
                });

        CommonResult result = new CommonResult();
        result.setSuccess(true);
        result.getData().put("businessLineList", list);
        return result;
    }

    @Override
    public CommonResult listScene(String businessLine) {
        CommonResult result = new CommonResult();
        if (StringUtils.isEmpty(businessLine)) {
            result.setMsg("业务线编码不能为空");
            return result;
        }
        if (BusinessLineType.of(businessLine) == null) {
            result.setMsg("业务线不存在");
            return result;
        }
        List<ScenePO> list = sceneDal.listByBusinessLine(businessLine, null);
        List<SceneVO> voList = new ArrayList<>();
        for (ScenePO po : list) {
            voList.add(toVO(po));
        }
        result.setSuccess(true);
        result.getData().put("sceneList", voList);
        return result;
    }

    @Override
    public CommonResult saveScene(SceneVO vo) {
        CommonResult result = new CommonResult();
        // 先格式后唯一，顺序固定
        if (StringUtils.isEmpty(vo.getName())) {
            result.setMsg("名称不能为空");
            return result;
        }
        if (StringUtils.isEmpty(vo.getCode())) {
            result.setMsg("CODE不能为空");
            return result;
        }
        if (!CODE_PATTERN.matcher(vo.getCode()).matches()) {
            result.setMsg("CODE仅允许小写字母、数字、中划线");
            return result;
        }
        if (StringUtils.isEmpty(vo.getBusinessLine())) {
            result.setMsg("请选择业务线");
            return result;
        }
        // unclassified 是存量模型兜底归属，不是可运营业务线，不允许挂新场景
        if (BusinessLineType.UNCLASSIFIED.getCode().equals(vo.getBusinessLine())) {
            result.setMsg("未分类不允许创建场景");
            return result;
        }
        if (BusinessLineType.of(vo.getBusinessLine()) == null) {
            result.setMsg("业务线不存在");
            return result;
        }
        ScenePO exist = sceneDal.getByCode(vo.getCode());
        if (exist != null && (vo.getId() == null || !exist.getId().equals(vo.getId()))) {
            result.setMsg("CODE已存在");
            return result;
        }
        // 编辑时变更业务线：场景下挂了模型的话，存量模型的 BUSINESS_LINE 会失配，拦掉
        if (vo.getId() != null) {
            ScenePO old = sceneDal.getById(vo.getId());
            if (old == null) {
                result.setMsg("场景不存在");
                return result;
            }
            if (!old.getBusinessLine().equals(vo.getBusinessLine())) {
                long modelCount = sceneDal.countModel(vo.getId());
                if (modelCount > 0) {
                    result.setMsg("该场景下有" + modelCount + "个模型，不可变更业务线");
                    return result;
                }
            }
        }

        ScenePO po = new ScenePO();
        po.setId(vo.getId());
        po.setBusinessLine(vo.getBusinessLine());
        po.setName(vo.getName());
        po.setCode(vo.getCode());
        po.setStatus(vo.getStatus() == null ? 1 : vo.getStatus());
        po.setSort(vo.getSort() == null ? 0 : vo.getSort());
        try {
            int count = sceneDal.save(po);
            if (count > 0) {
                result.setSuccess(true);
                result.getData().put("id", po.getId());
            } else {
                result.setMsg("保存失败");
            }
        } catch (DuplicateKeyException e) {
            // DB 唯一索引兜底
            result.setMsg("CODE已存在");
        }
        return result;
    }

    @Override
    public CommonResult deleteScene(Long[] ids) {
        CommonResult result = new CommonResult();
        if (ids == null || ids.length == 0) {
            result.setMsg("请选择要删除的场景");
            return result;
        }
        for (Long id : ids) {
            long modelCount = sceneDal.countModel(id);
            if (modelCount > 0) {
                result.setMsg("该场景下有" + modelCount + "个模型，不可删除");
                return result;
            }
        }
        for (Long id : ids) {
            sceneDal.delete(id);
        }
        result.setSuccess(true);
        return result;
    }

    private SceneVO toVO(ScenePO po) {
        SceneVO vo = new SceneVO();
        vo.setId(po.getId());
        vo.setBusinessLine(po.getBusinessLine());
        vo.setName(po.getName());
        vo.setCode(po.getCode());
        vo.setStatus(po.getStatus());
        vo.setSort(po.getSort());
        vo.setCreateTime(po.getCreateTime());
        vo.setUpdateTime(po.getUpdateTime());
        return vo;
    }
}
