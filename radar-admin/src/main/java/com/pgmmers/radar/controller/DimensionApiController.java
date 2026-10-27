package com.pgmmers.radar.controller;

import com.pgmmers.radar.service.common.CommonResult;
import com.pgmmers.radar.service.dimension.DimensionService;
import com.pgmmers.radar.vo.dimension.SceneVO;
import io.swagger.annotations.Api;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/services/v1/dimension")
@Api(value = "DimensionApi", description = "业务线与场景维度管理", tags = {"维度API"})
public class DimensionApiController {

    public static Logger logger = LoggerFactory.getLogger(DimensionApiController.class);

    @Autowired
    private DimensionService dimensionService;

    /**
     * 左树数据：业务线 -> 场景，带模型计数
     */
    @GetMapping("/tree")
    public CommonResult tree() {
        return dimensionService.tree();
    }

    /**
     * 业务线列表（枚举数据 + 场景数/模型数）
     */
    @GetMapping("/businessLine/list")
    public CommonResult listBusinessLine() {
        return dimensionService.listBusinessLine();
    }

    /**
     * 某业务线下场景列表
     */
    @GetMapping("/scene/list/{businessLine}")
    public CommonResult listScene(@PathVariable String businessLine) {
        return dimensionService.listScene(businessLine);
    }

    /**
     * 保存场景（新增/编辑）
     */
    @PutMapping("/scene")
    public CommonResult saveScene(@RequestBody SceneVO vo) {
        return dimensionService.saveScene(vo);
    }

    /**
     * 删除场景（批量）
     */
    @DeleteMapping("/scene")
    public CommonResult deleteScene(@RequestBody Long[] ids) {
        return dimensionService.deleteScene(ids);
    }
}
