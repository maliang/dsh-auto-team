# r14 T7 真机第二宿主 + CDP 取证

- 结论：**PASS**
- 时间：2026-11-04T05:14:15.530Z → 2026-11-04T05:14:43.921Z
- 仓库：/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
- 第二宿主：profile=rt14 port=51890 pid=71215 bootWarnings=0
- 产物对账：repo index=d8e421cbee0d / profile index=d8e421cbee0d
- 会话：session-21fc94cf-aa3c-4c94-908d-8b11091e2712（如何判断你现在的模型是deepsee 1h）

| 编号 | 取证项 | 结果 | 实测 |
| --- | --- | --- | --- |
| G1 | 产物新鲜（没有比 lib/ 更新的 src/*.ts） | ✅ | {"staleSources":0,"libMtime":"2026-11-04T05:11:15.750Z"} |
| G2 | profile 安装的是本轮产物（repo ↔ profile sha 相等） | ✅ | {"repoIndex":"d8e421cbee0d","profileIndex":"d8e421cbee0d","inConfig":true} |
| G3 | 宿主组合树含 dsh-auto-team | ✅ | {"dumpConfigHit":true} |
| G5 | 插件在真机生效（宿主侧：装配日志出现 [auto-team] 已装配，或 snapshot API 带 roles） | ✅ | {"assembled":"缺装配行（以 snapshot API 为准）","workspaceIsRepo":false,"snapshotApi":{"status":200,"bytes":8728,"hasRoles":true}} |
| G6 | 索引页 HTTP 200 + 引用 client bundle + snapshot API 可用 | ✅ | {"http":200,"bytes":41961,"bundleHref":"plugins/??@deepseek-ai/dsh-client-ui-user-questions/client.js,@deepseek-ai/dsh-client-ui-trajectory/client.js,@deepseek-ai/dsh-experimental-client-ui-agent-team/client.js,billion-context/client.js,dsh |
| S2 | 打开真实会话（会话头「自动团队」按钮出现） | ✅ | {"sessionId":"session-21fc94cf-aa3c-4c94-908d-8b11091e2712","label":"如何判断你现在的模型是deepsee 1h"} |
| S1 | 夹具 run 落盘（2 新 + 1 未记录工作区） | ✅ | {"files":["run-r14qa1.json","run-r14qa2.json","run-r14qa3.json"],"sessionId":"session-21fc94cf-aa3c-4c94-908d-8b11091e2712"} |
| P4a | 进度环内文字 2/3（done=2, total=3） | ✅ | {"ring":{"done":"2","total":"3"},"text":{"value":"2/3","tier":"short"}} |
| P4b | 进度环弧比 = 2/3（strokeDashoffset 实测） | ✅ | {"dash":175.929,"offset":58.6431,"ratio":0.6667} |
| P4c | 任务分组：未完成 1 / 已完成 2（组头文案） | ✅ | {"groups":[{"key":"open","head":"未完成 · 1","rows":1},{"key":"done","head":"已完成 · 2","rows":2}]} |
| P5 | 2 角色 3 任务 → 2 张角色卡（architect=done/2、qa=running/当前任务） | ✅ | {"count":2,"cards":[{"id":"architect","state":"done","done":"2","name":"架构师","active":"无进行中任务"},{"id":"qa","state":"running","done":"0","name":"QA 测试工程师","active":"真机复验画布拖动"}]} |
| P3 | qa 任务节点出现「测试」角色名 + 任务简述（3 节点 / 2 连线） | ✅ | {"nodes":[{"id":"t1","status":"done","role":"架构师","title":"梳理画布平移与复位实现"},{"id":"t2","status":"done","role":"架构师","title":"补齐角色卡片派生字段"},{"id":"t3","status":"running","role":"QA 测试工程师","title":"真机复验画布拖动"}],"edges":2} |
| P1 | 画布拖动 100px → viewport 位移 ≥90px | ✅ | {"start":{"x":857,"y":728},"before":{"tx":0,"ty":0},"after":{"tx":100,"ty":0},"displacement":100,"draggingAfterRelease":"false"} |
| P2 | 「重置视图」后 transform≈0（并经历 data-resetting=true→false） | ✅ | {"clicked":true,"resettingNow":"true","resetImmediate":{"tx":100,"ty":0},"after":{"tx":0,"ty":0},"resettingAfter":"false"} |
| P8 | 画布定位上下文：可平移层锚在画布原点、重置按钮在框内、画布不越出分区且不撑破页面（r14 D4） | ✅ | {"canvas":{"x":817,"y":578,"w":599,"h":300},"position":"relative","viewportOrigin":{"dx":1,"dy":1},"regionContainsCanvas":true,"resetInside":true,"nodesInsideVertically":true,"nodeCount":3,"pageOverflowX":false} |
| P6a | 本项目分桶 2 行 run，标题取 goal | ✅ | {"nav":{"kind":"project","pid":"/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team","name":"dsh-auto-team","meta":"2 次运行 · 11-04 13:14:07","token":"不可得","active":"true"},"rows":[{"id":"run-r14qa2","title":"项目库第二行回归","source": |
| P6b | 历史桶 5 行（4 旧 + 1 未记录工作区），回退标题「未命名任务 · r14qa3」 | ✅ | {"bucket":{"name":"历史运行（未记录工作区）","meta":"5 次运行 · 11-04 13:14:32"},"rowCount":5,"fallbackRow":{"id":"run-r14qa3","title":"未命名任务 · r14qa3","source":"fallback","titleAttr":"本轮没有记录目标（run run-r14qa3）","meta":"r14qa3 · ? terminated · 不可得 · 2 秒"}, |
| P6c | 项目库无「未知项目」字面 | ✅ | {"noUnknown":true} |
| P6d | 历史运行分桶名 = 历史运行（未记录工作区） | ✅ | {"name":"历史运行（未记录工作区）","meta":"5 次运行 · 11-04 13:14:32"} |
| P6e | 项目库分栏：[data-project-split] 锚点存在且挂在 [data-library-body] 上 + --lib-list-w 默认 220px + 拖拽手柄存在 | ✅ | {"width":"220px","handle":true,"shell":true,"splitAttr":true,"splitIsBody":true,"ariaNow":"220"} |
| P6f | 分栏拖手柄 +80px：列表宽变化 ≥60px，外框宽度不变，锚点仍在 | ✅ | {"before":{"listW":220,"shellW":1160},"after":{"listW":300,"shellW":1160,"varW":"300px"},"delta":80} |
| P6g1 | 双击手柄复位 220px | ✅ | {"after":220,"varW":"220px"} |
| P6g2 | 键盘 ArrowRight ×2：宽度 236px | ✅ | {"after":236,"varW":"236px"} |
| P7-prep | 详情区可滚动且已记录 scrollTop/焦点 | ✅ | {"height":460,"naturalMax":0,"forced":true,"max":299,"paneClientHeight":264,"paneScrollHeight":563,"savedScrollTop":200,"rowCount":5,"rowId":"run-mw1gr8qb-frc","rowTitle":"未命名任务 · qb-frc","backgroundHtmlLength":5348} |
| P7a | 抽屉打开：单实例 dialog、标题=行标题、焦点入内、内容复用环/卡/画布、背景列表未卸载 | ✅ | {"count":1,"runId":"run-mw1gr8qb-frc","role":"dialog","modal":"true","title":"未命名任务 · qb-frc","subtitle":"qb-frc · terminated · 不可得 · 不可得","focusInside":true,"activeTag":"BUTTON:关闭详情","ring":1,"ringText":"1/1","cards":1,"canvas":1,"backgrou |
| P7b | Esc 关闭抽屉后 scrollTop 复原、焦点回到原行 | ✅ | {"closeMethod":"cdp-key","drawerCount":0,"scrollTop":200,"savedScrollTop":200,"focusRestored":true,"activeTag":"BUTTON:run-mw1gr8qb-frc","backgroundRows":5} |
| G7 | 客户端无插件相关异常 / 插件 API 无 4xx-5xx | ✅ | {"relevantErrors":[],"apiFailures":[],"totalErrorEntries":0,"totalFailedRequests":0} |

## 截图
- tasks-page.png
- canvas-dragged.png
- canvas-contained.png
- library-page.png
- drawer-open.png

## 清理
- 夹具 run：已删除（run-r14qa1.json, run-r14qa2.json, run-r14qa3.json）
- 第二宿主：已停止

## 证据文件
- capture/real-host-r14.json（本阶段完整快照；过程产物）
- capture/captures.json（归档保留：按 harness 追加同一份证据）
