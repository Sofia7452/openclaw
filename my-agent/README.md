# my-agent

一个最小可运行的 TypeScript Agent 框架示例，围绕 4 个上下文工程策略：

- `Write`：长期记忆写入 `MEMORY.md`
- `Select`：按工具清单/技能元数据选择能力
- `Compress`：上下文超预算时做摘要压缩
- `Isolate`：通过 `sessions_spawn` 委派子代理，隔离上下文

## 功能概览

- 多轮对话（同一进程内保留会话历史）
- 工具调用（读文件、执行命令、代码搜索）
- 子代理感觉委派（`sessions_spawn`）
- 长期记忆（`update_memory` + `MEMORY.md`）
- 上下文压缩（`MemoryCompactor`）
- 技能发现（扫描 `skills/` 下的 `SKILL.md` 元数据）

## 环境要求

- Node.js 22+
- 可用的 OpenAI 兼容接口 Key

## 快速开始

```bash
cd my-agent
npm install
```

创建 `.env`（示例）：

```env
OPENAI_API_KEY=your_api_key
LLM_MODEL=gpt-4o-mini
# 可选：OpenAI 兼容网关
# OPENAI_BASE_URL=https://api.openai.com/v1

# 可选：上下文预算（越小越容易触发压缩）
MAX_CONTEXT_TOKENS=4000
```

运行交互式 Demo：

```bash
npm run demo
```

## 交互命令

在 `demo` 里可用：

- `/exit`：退出
- `/reset`：清空当前会话历史（不清除 `MEMORY.md`）
- `/memory`：查看当前长期记忆内容

## 如何触发关键能力

### 1) 触发子代理（Sub-agent）

建议明确要求委派：

```text
必须先调用 sessions_spawn 两次：
1) 子代理A只分析 src/memory，toolAllowlist 仅 ["read_file","search_code"]
2) 子代理B只分析 src/tools，toolAllowlist 仅 ["read_file","search_code"]
最后主代理合并结论。
```

### 2) 触发长期记忆

```text
请先调用 update_memory，把“我偏好中文回答，代码示例优先 TypeScript”写入长期记忆，然后再继续回答。
```

然后输入 `/memory` 验证是否已写入。

### 3) 触发上下文压缩

- 方法 A：降低 `MAX_CONTEXT_TOKENS`（例如 `2000`）
- 方法 B：连续多轮输入较长内容

触发后你会看到：

- 运行日志出现 `Context compaction triggered X time(s).`
- 历史中出现 `[Context summary: ...]`

## 项目结构

```text
my-agent/
  src/
    agent.ts                # ReAct 主循环
    context-builder.ts      # 上下文组装与预算控制
    memory/
      long-term.ts          # MEMORY.md 读写 + update_memory 工具
      compaction.ts         # LLM 摘要压缩
    tools/
      read.ts               # read_file
      exec.ts               # exec
      search.ts             # search_code
      sessions.ts           # sessions_spawn 子代理
    llm/
      openai-provider.ts    # OpenAI 兼容 Provider
    demo.ts                 # 交互式入口
  skills/                   # 技能元数据目录
  MEMORY.md                 # 长期记忆文件（运行时生成/更新）
```

## NPM Scripts

- `npm run demo`：运行交互式 demo
- `npm run test`：运行测试
- `npm run build`：TypeScript 构建

## 设计说明（简版）

- `Agent` 持有 `conversationHistory`，所以同一个进程内是天然多轮。
- `ContextBuilder` 每轮重新构造系统提示并控制上下文预算。
- `LongTermMemory` 将跨会话信息写入文件，并在每轮注入系统提示。
- `MemoryCompactor` 在预算紧张时，把旧消息压成摘要，保留近期上下文。
- `sessions_spawn` 用新建子 Agent 的方式隔离任务上下文，避免主线污染。

## 常见问题

1. 为什么像单轮？

通常是每次请求都重建了 `Agent` 实例，或者只调用了一次 `agent.run()` 就退出。

2. 为什么看不到压缩？

默认预算较大，短对话不触发。请降低 `MAX_CONTEXT_TOKENS` 或增加对话长度。

3. `MEMORY.md` 何时更新？

只有模型调用 `update_memory` 工具时才会更新。
