# src/db/ — 持久化模块

IndexedDB 封装（T6 实现）：会话与消息的存取、恢复、"生成中断"标注。settings 的持久化在 stores/settings.ts 内用 localStorage（体量小）。

规则：只被 stores 调用，组件不直接触达。
