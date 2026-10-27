package com.pgmmers.radar.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.charset.StandardCharsets;
import java.util.Collections;

/**
 * 把 JSON 响应的 Content-Type 改成 application/json;charset=UTF-8，
 * 否则 Tomcat 默认按 ISO-8859-1 解码导致中文乱码。
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void configureMessageConverters(java.util.List<org.springframework.http.converter.HttpMessageConverter<?>> converters) {
        int idx = -1;
        for (int i = 0; i < converters.size(); i++) {
            if (converters.get(i) instanceof MappingJackson2HttpMessageConverter) {
                idx = i;
                break;
            }
        }
        MappingJackson2HttpMessageConverter conv = idx >= 0
                ? (MappingJackson2HttpMessageConverter) converters.get(idx)
                : new MappingJackson2HttpMessageConverter(new ObjectMapper());
        conv.setDefaultCharset(StandardCharsets.UTF_8);
        conv.setSupportedMediaTypes(Collections.singletonList(MediaType.APPLICATION_JSON_UTF8));
        if (idx >= 0) {
            converters.set(idx, conv);
        } else {
            converters.add(conv);
        }
    }
}