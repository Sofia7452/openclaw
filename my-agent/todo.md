# my-agent TODO

## Context & Memory Upgrade Plan

目标：把当前 `my-agent` 从“可跑”提升到“可持续多轮、可控成本、可稳定召回”的工程化状态。

### Current Gaps

- [ ] 长期记忆是整文件覆盖写入，缺少变更历史与并发安全（`my-agent/src/memory/long-term.ts`）。
- [ ] 每轮注入整份 `MEMORY.md`，召回不精准且容易撑爆上下文（`my-agent/src/context-builder.ts`）。
- [ ] 压缩策略偏单一，超长消息与失败兜底不足（`my-agent/src/memory/compaction.ts`）。
- [ ] 子代理缺少深度限制、并发子任务限制、循环/失控防护（`my-agent/src/tools/sessions.ts`）。

### Phase 1 - Stability Guards (1-2 days)

- [ ] 增加 context window guard（低于阈值告警/阻断）。
- [ ] 增加 tool result hard cap（持久化前截断超大结果）。
- [ ] 增加 tool loop detection（重复调用 + 无进展检测与熔断）。
- [ ] 给 `sessions_spawn` 增加 `maxSpawnDepth` 和 `maxChildrenPerAgent`。

Implementation hints:
- 参考 `src/agents/context-window-guard.ts`
- 参考 `src/agents/session-tool-result-guard.ts`
- 参考 `src/agents/tool-loop-detection.ts`
- 参考 `src/agents/subagent-depth.ts`

### Phase 2 - Structured Long-Term Memory (2-4 days)

- [ ] 把 `update_memory(content)` 升级为操作式接口：
  - `add_fact`
  - `update_fact`
  - `archive_fact`
  - `delete_fact`
- [ ] 记忆从单文件升级为分层结构：
  - `memory/facts.md`
  - `memory/preferences.md`
  - `memory/decisions.md`
- [ ] 增加 append-only memory log（记录每次变更）。
- [ ] 增加 schema 校验、去重、冲突处理。

Suggested file targets:
- `my-agent/src/memory/long-term.ts`
- `my-agent/src/types.ts`
- `my-agent/src/tools/` (new memory ops tool)

### Phase 3 - Retrieval First, Not Full Injection (3-5 days)

- [ ] 增加 `memory_search` 工具（语义/关键词召回 top-k）。
- [ ] 增加 `memory_get` 工具（按 path + line range 精读）。
- [ ] `ContextBuilder` 从“全量注入记忆”改为“按 query 注入命中片段”。
- [ ] 增加记忆注入预算上限（字符/Token）。
- [ ] 先实现 FTS，再逐步接向量检索与 hybrid rerank。

Implementation hints:
- 参考 `src/agents/tools/memory-tool.ts`
- 参考 `src/memory/search-manager.ts`
- 参考 `src/memory/hybrid.ts`

### Phase 4 - Robust Compaction Pipeline (3-5 days)

- [ ] 从单次摘要升级为分块摘要 + staged merge。
- [ ] 对超长消息加入 fallback（跳过并生成说明标记）。
- [ ] 建立分层摘要：turn summary -> session summary。
- [ ] 增加 compaction invariant 校验（保留决策/TODO/约束）。

Implementation hints:
- 参考 `src/agents/compaction.ts`
- 参考 `src/agents/pi-extensions/context-pruning/pruner.ts`
- 参考 `src/agents/pi-embedded-runner/tool-result-context-guard.ts`

### Phase 5 - Observability & Quality Gates (2-3 days)

- [ ] 输出上下文报告：token 构成、裁剪比例、记忆命中率。
- [ ] 建立回归集：
  - 多轮追踪
  - 记忆误召回
  - 压缩前后答案一致性
- [ ] 增加故障注入测试：
  - 摘要失败
  - 检索后端不可用
  - 并发写入冲突

### Recommended Rollout Order

- [ ] Step 1: Phase 1（先止血，稳定性优先）
- [ ] Step 2: Phase 3（先把“全量注入”替换为“检索注入”）
- [ ] Step 3: Phase 4（长会话压缩体系完善）
- [ ] Step 4: Phase 2（结构化长期记忆）
- [ ] Step 5: Phase 5（指标与质量门槛）

### First Sprint Checklist

- [ ] 在 `AgentOptions` 中加入 loop detection / guard 配置项。
- [ ] 在 `Agent.run()` 中接入 tool-loop 检测与 early stop。
- [ ] 在 `ContextBuilder.build()` 前后输出 token 预算 debug 信息。
- [ ] 给 `sessions_spawn` 加深度限制与活跃子任务上限。
- [ ] 为上述改动补充单测与 e2e 用例。
