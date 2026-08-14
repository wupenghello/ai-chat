# src/api/ — API 客户端模块

OpenAI 兼容协议的流式对话客户端（T3 实现）：供应商可配置（base URL / 模型 / 密钥来自 settings store）、SSE 流式解析、上下文组装（最近 20 轮截断）。

规则：只被 stores 调用，不直接触碰组件；测试一律用 mock，不依赖真实服务。
