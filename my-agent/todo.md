# my-agent TODO

## 目标

把当前 `my-agent` 从“可跑”升级为一个 **稳准快** 的 Agent 系统：

- 稳：长会话不崩、工具链不失控、失败可恢复
- 准：优先基于证据回答，减少幻觉与遗漏
- 快：在可接受成本下给出高质量结果，避免无效 token 消耗

---

## 0. 总体思路（依据：上下文工程闭环）

采用 `Gather -> Glean/Compact -> Generate -> Evaluate` 的闭环迭代：

1. Gather（取证）
   - 先取证后回答：工具 + 记忆检索，而不是仅靠模型“猜”。
2. Glean/Compact（筛选压缩）
   - 只保留与当前任务相关的上下文；压缩历史和大工具结果。
3. Generate（生成与路由）
   - 根据任务选择模型；失败自动回退，提升最终完成率。
4. Evaluate（评估反馈）
   - 以任务成功率/准确率/时延/成本做持续评估，驱动下一轮优化。

对齐参考（OpenClaw）：
- 记忆检索：`src/agents/tools/memory-tool.ts`, `src/memory/manager.ts`
- 上下文裁剪/压缩：`src/agents/pi-extensions/context-pruning/pruner.ts`, `src/agents/compaction.ts`
- 运行时守护：`src/agents/tool-loop-detection.ts`, `src/agents/context-window-guard.ts`, `src/agents/session-tool-result-guard.ts`
- 模型路由回退：`src/agents/model-selection.ts`, `src/agents/model-fallback.ts`
- 测试分层：`docs/help/testing.md`, `docs/reference/test.md`, `scripts/bench-model.ts`

---

## 1. 质量目标与指标（先立度量，再做优化）

### 1.1 稳定性（稳）

- [ ] 会话连续成功率（多轮不中断）>= 99%
- [ ] 工具调用死循环触发率 < 1%
- [ ] 上下文超限导致失败率 < 1%

### 1.2 准确性（准）

- [ ] 关键问答“有证据回答”占比 >= 90%
- [ ] 记忆召回命中率（top-k 含目标信息）>= 85%
- [ ] 压缩后关键事实保真率 >= 95%

### 1.3 性能与成本（快）

- [ ] p50 首响时延下降 20%
- [ ] 平均 token 成本下降 20%
- [ ] 工具链平均迭代步数下降 15%

### 1.4 先加观测（必须先做）

- [ ] 每次 run 输出：
  - `iterations`
  - `tool_calls_count`
  - `input/output token estimate`
  - `compaction count`
  - `memory hits`
  - `latency ms`
- [ ] 保存到本地 JSONL 指标日志（用于回归对比）

建议文件：
- `my-agent/src/agent.ts`
- `my-agent/src/context-builder.ts`
- `my-agent/src/demo.ts`
- 新增：`my-agent/src/infra/metrics.ts`

---

## 2. 分阶段迭代（小步可回滚）

> 原则：每个阶段都要“可验证、可回退、可独立上线”。

### Phase A（Sprint 1）- 稳定性地基（稳优先）

目标：先把系统跑稳，避免长会话崩坏。

- [ ] A1. 上下文窗口守卫
  - 预算过低时 warn/block，避免无意义请求。
- [ ] A2. 工具结果硬截断
  - 防止超大工具输出吞噬上下文。
- [ ] A3. 工具循环检测
  - 同参重复 + 无进展熔断。
- [ ] A4. 子代理治理
  - `maxSpawnDepth` + `maxChildrenPerAgent`。

参考：
- `src/agents/context-window-guard.ts`
- `src/agents/session-tool-result-guard.ts`
- `src/agents/tool-loop-detection.ts`
- `src/agents/subagent-depth.ts`

落地到 my-agent：
- `my-agent/src/agent.ts`
- `my-agent/src/tools/sessions.ts`
- 新增：`my-agent/src/guards/`

验收：
- [ ] 新增单测：死循环、超大工具结果、深度超限均被拦截
- [ ] 20 轮对话无崩溃、无无限循环

---

### Phase B（Sprint 2）- 证据驱动回答（准优先）

目标：把“全量注入记忆”改成“按需检索记忆”。

- [ ] B1. 引入 `memory_search`
  - 关键词/FTS 召回 top-k 片段。
- [ ] B2. 引入 `memory_get`
  - 按 path + line range 精读。
- [ ] B3. 改造 ContextBuilder
  - 从“注入整个 MEMORY.md”改为“注入命中片段 + 引用来源”。
- [ ] B4. 记忆注入预算
  - 限制注入字符/token，防止喧宾夺主。

参考：
- `src/agents/tools/memory-tool.ts`
- `src/memory/manager.ts`
- `src/memory/hybrid.ts`

落地到 my-agent：
- 新增：`my-agent/src/tools/memory-search.ts`
- 新增：`my-agent/src/tools/memory-get.ts`
- 修改：`my-agent/src/context-builder.ts`
- 修改：`my-agent/src/memory/long-term.ts`

验收：
- [ ] 构建一个 30 条事实的记忆样本，top-3 命中率 >= 85%
- [ ] 对照测试中“凭空回答”比例明显下降

---

### Phase C（Sprint 3）- 压缩体系升级（稳+快）

目标：长会话下稳态运行，且不牺牲关键信息。

- [ ] C1. 分块压缩 + 分阶段合并
- [ ] C2. 超长消息 fallback（跳过并标注）
- [ ] C3. 分层摘要（turn -> session）
- [ ] C4. 摘要保真校验（决策/TODO/约束不可丢）

参考：
- `src/agents/compaction.ts`
- `src/agents/pi-extensions/context-pruning/pruner.ts`
- `src/agents/pi-embedded-runner/tool-result-context-guard.ts`

落地到 my-agent：
- 修改：`my-agent/src/memory/compaction.ts`
- 新增：`my-agent/src/memory/compaction-validator.ts`

验收：
- [ ] 50+ 轮长对话仍可持续回答
- [ ] 压缩后回问关键决策，保真率 >= 95%

---

### Phase D（Sprint 4）- 模型路由与回退（稳+快）

目标：提高最终完成率并控制时延。

- [ ] D1. 任务类型到模型路由策略
  - 例如：检索型/工具型/总结型使用不同模型档位。
- [ ] D2. 失败回退链路
  - 超时、限流、工具不兼容时自动切换 fallback 模型。
- [ ] D3. 冷却与探活
  - 降低反复命中坏模型的概率。

参考：
- `src/agents/model-selection.ts`
- `src/agents/model-fallback.ts`

落地到 my-agent：
- 新增：`my-agent/src/llm/model-router.ts`
- 新增：`my-agent/src/llm/model-fallback.ts`
- 修改：`my-agent/src/agent.ts`

验收：
- [ ] 注入 provider 故障场景下，任务成功率显著高于无 fallback
- [ ] 平均失败恢复时间可观测并下降

---

### Phase E（Sprint 5）- 结构化长期记忆（准+稳）

目标：长期记忆可维护、可回溯、可治理。

- [ ] E1. `update_memory` 升级为操作式 API
  - `add_fact/update_fact/archive_fact/delete_fact`
- [ ] E2. 记忆分层
  - `memory/facts.md`
  - `memory/preferences.md`
  - `memory/decisions.md`
- [ ] E3. append-only memory log
- [ ] E4. 去重、冲突解决、版本化

参考：
- `src/hooks/bundled/session-memory/handler.ts`（会话记忆沉淀思路）

落地到 my-agent：
- 修改：`my-agent/src/memory/long-term.ts`
- 新增：`my-agent/src/memory/store.ts`
- 新增：`my-agent/src/tools/memory-update.ts`

验收：
- [ ] 记忆变更可审计
- [ ] 连续 7 天会话下，关键偏好可稳定复用

---

### Phase F（Sprint 6）- 评测体系产品化（准+快+稳）

目标：把“感觉变好”变成“数据证明变好”。

- [ ] F1. 建立小型任务基准集（本地可重复）
  - 检索问答
  - 多步工具任务
  - 长会话压缩回问
- [ ] F2. 建立三层测试：
  - CI-safe deterministic
  - E2E
  - Live（可选，环境变量控制）
- [ ] F3. 增加性能基准脚本
  - 首响/总耗时/token 消耗

参考：
- `docs/help/testing.md`
- `docs/reference/test.md`
- `scripts/bench-model.ts`

落地到 my-agent：
- 新增：`my-agent/tests/evals/*.test.ts`
- 新增：`my-agent/scripts/bench.ts`

验收：
- [ ] 每次迭代前后有可对比报表
- [ ] 回归时可快速定位是“准”问题还是“快”问题

---

## 3. 里程碑（建议）

- M1（2 周）：完成 Phase A + B
  - 结果：系统可稳定多轮 + 基于证据回答
- M2（4 周）：完成 Phase C + D
  - 结果：长会话稳定 + 回退提升完成率 + 性能更稳
- M3（6 周）：完成 Phase E + F
  - 结果：长期记忆工程化 + 指标化持续优化闭环

---

## 4. 当前立即执行（Next 5 tasks）

- [ ] Task 1: 在 `agent.ts` 增加 run metrics JSONL 输出
- [ ] Task 2: 实装工具循环检测（最小可用版）
- [ ] Task 3: 实装工具结果硬截断（最小可用版）
- [ ] Task 4: 新增 `memory_search`（先 FTS 版本）
- [ ] Task 5: 将 `context-builder` 改为“只注入记忆命中片段”

完成这 5 项后再进入下一轮评估与拆解。
