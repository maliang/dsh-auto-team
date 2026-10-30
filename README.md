# dsh-auto-team（自动团队）

把当前 DeepSeek Harness 会话变成队长：目标自动拆成**有依赖的任务图**，按角色**并行**派出可续聊成员，完成必须过**质量门禁**，全过程在输入框下方的开关与右栏「自动团队」面板里可见可改。

## 能力一览

| 能力 | 入口 |
| --- | --- |
| 启用/停用（默认关，按会话持久化） | 输入框下方 `conversation.composer.dock` 开关行 |
| 执行计划（任务/依赖/角色/模型/预计并发） | 右栏「自动团队」面板 › 计划 |
| 成员实时活动（角色/任务/状态/最近事件/实际模型路由） | 面板 › 成员（含消息流、继续对话、证据抽屉） |
| 团队记忆（公共/项目双轨 md，可查看可编辑） | 面板 › 记忆 |
| 角色库（内置 6 个 + 自建/修改，每角色可指定模型） | 面板 › 角色 |

## 开发

```bash
pnpm install
pnpm typecheck      # tsc --noEmit
pnpm test           # node --test（纯逻辑单测）
pnpm build          # 产出 lib/index.js + lib/client.js
```

产物自检（AC-7 / AC-8）：

```bash
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
```

## 安装（本机 profile=desktop，`dsh` 不在 PATH）

```bash
cd /Users/maliang/.dsh/profiles/desktop
pnpm add file:/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
# 未自动登记时编辑同目录 package.json：dsh.profile.bundles 末尾追加 "dsh-auto-team"
grep -c "dsh-auto-team" package.json   # 期望 ≥1
```

重启 DeepSeek Harness → 刷新 Web GUI → 输入框下方出现「自动团队」开关。

回滚：

```bash
cd /Users/maliang/.dsh/profiles/desktop
pnpm remove dsh-auto-team
# 并从 dsh.profile.bundles 中删除 "dsh-auto-team"
grep -c "dsh-auto-team" package.json   # 期望 0
```

## 文档

- 架构与模块契约：`docs/teamflow/architecture/ARCHITECTURE.md`
- 本需求的设计/验收：`docs/teamflow/20261030-r1-auto-team-plugin/`
- 团队约定与文档索引：`AGENTS.md`
