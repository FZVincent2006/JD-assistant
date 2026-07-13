# 飞书招聘文档 OpenAPI 自动写入设计

日期：2026-07-13
状态：待用户书面复核
目标插件：招聘 JD 发布助手

## 1. 目标与边界

在现有浏览器插件中保留 Boss 直聘和脉脉的全部能力，新增通过飞书 OpenAPI 写入招聘文档的模式。单次输入只包含一家公司，但可以包含多个岗位。用户在侧边栏完成解析、编辑预览和确认后，插件依次更新：

1. `岗位JD整理`
2. `Portfolio开放岗位汇总`

测试和端到端验收只允许写入以下副本：

`https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv?fromScene=spaceOverview`

正式文档在副本验收通过前没有写入入口。实现不再依赖飞书页面滚动、DOM 定位、剪贴板或模拟粘贴。

## 2. 已验证基线与回滚

### 2.1 当前基线

- 基线提交：`635bd38af75b817756b6c55f079e737b6c07a1ef`
- 永久回滚分支：`codex/pre-feishu-openapi-baseline`
- OpenAPI 功能分支：`codex/feishu-openapi`
- 飞书功能开始前的基线提交：`515cc46`

已对 `515cc46` 与当前基线进行逐文件比较：

- `src/lib/jdParser.js` 的 SHA-256 均为 `709e2fa1d89f300fa0d9085069827e0d5cbfd85b5d85c90035178b9a5ac32b28`。
- `src/content/formFiller.js` 的 SHA-256 均为 `7d5578d8526c6ca1bf01976efa54ee1a92f9b5c94534c6e7c70d142bd1925215`。
- 对应的 `jdParser` 和 `formFiller` 测试文件也逐字节一致。
- 共享消息入口和侧边栏只增加了飞书分支，没有改写原有 Boss/脉脉分支。

2026-07-13 的验证结果为 11 个测试文件、96 项测试全部通过，其中 `formFiller` 包含 40 项 Boss/脉脉表单回归测试；`npm run build` 成功。

### 2.2 回归保护

- OpenAPI 开发不得修改 `src/lib/jdParser.js` 或 `src/content/formFiller.js`。
- 增加自动完整性检查，生产构建时校验上述两个文件的 SHA-256。
- `sendFillRequest`、Boss/脉脉的 UI 分支和消息类型保持原行为；对共享入口的任何必要改动只能是飞书分支的增删，且必须有回归测试。
- 每个可交付提交必须通过完整 `npm test` 和 `npm run build`。
- 如新功能出现不可接受的问题，可直接切回 `codex/pre-feishu-openapi-baseline`，恢复到 `635bd38`。

## 3. 授权架构

### 3.1 主路径：纯插件 PKCE

插件使用 OAuth 2.0 Authorization Code + PKCE S256 获取 `user_access_token`：

- 不把 App Secret 放入插件。
- 不申请 `offline_access`，不保存 `refresh_token`。
- `user_access_token` 和到期时间只存入 `chrome.storage.session`，关闭浏览器或凭证到期后重新授权。
- Chrome 与 Edge 共用认证代码；分别配置允许的扩展回调 URL。
- 侧边栏只接收授权状态，不接触凭证；所有 OpenAPI 请求从扩展后台 service worker 发出。

开发第一项为真实接口兼容性验证：使用飞书当前 v2 token 端点确认 `code_verifier` 模式可在不提交 `client_secret` 的情况下兑换 token。判断规则固定如下：

- 验证成功：保留纯插件主路径。
- 飞书明确要求 `client_secret`：不尝试历史接口、不把 Secret 写入插件，启用本地助手兜底。

### 3.2 兜底路径：macOS 本地授权助手

兜底只替换授权适配器，不替换解析、计划、渲染和 OpenAPI 文档模块：

- 插件通过 Chrome/Edge Native Messaging 把一次性授权码交给本地助手。
- 本地助手调用飞书 token 端点并把短期 `user_access_token` 返回给扩展后台。
- App Secret 由应用管理员在安装时录入 macOS Keychain，不进入扩展包、日志或普通配置文件。
- 安装器在当前用户目录同时注册 Chrome 和 Edge 的 Native Messaging host；不开放本地端口，不常驻运行，由浏览器按需启动。
- 四位用户各自使用自己的飞书账号授权，文档权限跟随用户身份。

本地计算机管理员理论上仍可提取本机密钥；若组织安全策略不允许 Secret 出现在用户设备上，则唯一合规替代是托管 token broker。该替代不在当前无服务器范围内。

## 4. 组件边界

### 4.1 保留模块

- 单岗位解析器 `parseJd`
- Boss/脉脉表单填写器
- Boss/脉脉诊断和点击记录
- 现有多岗位 `CompanyDraft` / `JobDraft` 解析与可编辑预览

### 4.2 新增或替换模块

- `feishuAuth`：统一认证接口，封装 PKCE 与 Native Messaging 两个适配器。
- `feishuApiClient`：请求、分页、错误标准化、版本号和请求日志 ID 提取。
- `feishuWikiResolver`：把固定 Wiki URL 中的节点 token 解析为 `docx` 的 `obj_token`。
- `feishuBlockReader`：读取全部文档块，建立块 ID、父子关系、顺序和纯文本索引。
- `feishuTemplateReader`：从现有完整公司块提取标题、Callout、QuoteContainer、列表和文本样式，只复制样式，不复制内容。
- `feishuOpenApiPlan`：生成新公司置顶或老公司追加的不可变写入计划。
- `feishuBlockRenderer`：把 `CompanyDraft` 转换成创建嵌套块请求。
- `feishuOpenApiWriter`：按阶段执行、校验并输出部分成功结果。
- `feishuBackgroundMessages`：侧边栏与后台之间的 `AUTH`、`INSPECT`、`PLAN`、`WRITE` 消息协议。

旧的 DOM 扫描和粘贴模块不再参与飞书写入。测试副本也不再注入飞书 content script。

## 5. 权限和安全

飞书用户授权只请求：

- `wiki:wiki:readonly`：把 Wiki 节点 token 解析为实际文档 token。
- `docx:document:readonly`：读取和校验文档块。
- `docx:document:write_only`：创建文档块。

不请求联系人、消息、云盘管理或文档权限管理范围。调用使用 `user_access_token`，因此还要求当前用户本身拥有目标文档的阅读和编辑权限。

浏览器 manifest：

- 增加 `identity` 和 `storage`。
- 增加 `https://accounts.feishu.cn/*` 与 `https://open.feishu.cn/*` host 权限。
- 移除仅为旧飞书粘贴方案增加的 `clipboardRead`、`clipboardWrite` 和飞书页面 content-script match；Boss/脉脉原有 host 权限保持不变。
- 只有启用本地助手构建时才增加 `nativeMessaging`。

后台日志不得包含 access token、授权码、code verifier、App Secret、完整 JD 或公司介绍。错误界面只显示阶段、飞书错误码、HTTP 状态和 `x-tt-logid`。

## 6. 文档检查与模板提取

### 6.1 固定目标验证

每次检查和写入都从配置中的 Wiki token 开始，不接受 UI 传入任意文档 ID。解析结果必须同时满足：

- `obj_type` 为 `docx`。
- 文档标题与配置的测试副本标题一致。
- `Portfolio开放岗位汇总` 唯一存在。
- `岗位JD整理` 唯一存在。

任一条件不满足时停止，不猜测位置。

### 6.2 模板样式

插件从 `岗位JD整理` 中第一个结构完整的现有公司提取样式蓝图：

- 公司名：Heading 1。
- `公司介绍`：Heading 2。
- 公司介绍内容：Callout 及其背景色、图标和子列表样式。
- `开放岗位`：Heading 2。
- 岗位标题：模板中的对应文本块样式。
- 岗位正文：QuoteContainer、固定小标题和 Bullet 样式。

汇总区同样从第一个完整公司条目提取公司文本或链接样式及岗位 Bullet 样式。找不到唯一且完整的模板时，检查失败，不执行写入。

### 6.3 归一化和重复检查

- 公司名和岗位名比较时统一全半角空格、连续空白、横线、竖线和大小写。
- 同名公司出现多于一次时停止。
- 同公司同岗位已存在时停止整个提交，不覆盖也不追加。
- 老公司岗位序号必须能解析且不重复；新岗位从最大序号加一。
- 计划生成后保存读取到的文档版本号；执行前版本已变化时要求重新检查。

## 7. 写入格式与位置

### 7.1 新公司

`岗位JD整理` 中，在首家公司 Heading 1 前创建：

1. 公司名 Heading 1。官网存在时，公司名文本带链接；否则为纯文本。
2. `公司介绍` Heading 2。
3. Callout。公司介绍每段为 Bullet；缺失时写入一个 `待补充` Bullet。
4. `开放岗位` Heading 2。
5. 每个岗位的标题块：`（n）岗位｜地点｜类型`。
6. 每个岗位的 QuoteContainer，包含 `工作内容：`、`职位要求：`，以及可选的 `加分项：`；各部分内容使用 Bullet。

`Portfolio开放岗位汇总` 中，在首家公司条目前创建公司名和岗位 Bullet：

- `岗位｜地点｜类型`

飞书按现有文档样式自动重新编号标题。

### 7.2 老公司新增岗位

- JD 区在该公司 `开放岗位` 分组末尾、下一家公司 Heading 1 之前追加岗位标题和 QuoteContainer。
- 汇总区在该公司的最后一个岗位 Bullet 后追加。
- 不重复创建公司名、公司介绍或 `开放岗位` 标题。

### 7.3 富文本安全

所有文本使用 OpenAPI TextRun 数据结构生成，不拼接 HTML。官网只接受 `http:` 或 `https:` URL。输入中的控制字符被移除，用户文本不能改变块类型、父子关系或目标文档。

## 8. 执行、并发和错误处理

固定执行顺序：

1. 检查授权、固定目标、文档结构、模板、重复项和版本号。
2. 显示完整写入计划，等待用户确认。
3. 使用创建嵌套块接口写入 JD 区。
4. 重新读取文档，校验公司位置、Heading 类型、Callout、岗位数量、序号和 QuoteContainer。
5. 写入汇总区。
6. 重新读取文档，校验公司位置和岗位 Bullet。

不自动重试写操作，不自动撤销。为避免每秒三次的文档编辑限制，写入器主动串行化请求并保持安全间隔；若仍收到限流、权限、版本冲突或结构错误，立即停止。

若请求超时且服务端可能已经写入，只执行一次只读校验：

- 目标结构完整存在：标记该阶段成功。
- 目标结构不存在：标记失败。
- 无法读取：标记结果未知，并给出阶段和建议人工检查位置；不得再次提交相同写请求。

结果类型包含：`completedStages`、`failedStage`、`status`、`documentUrl`、`companyName`、`jobTitles`、`errorCode`、`logId` 和 `repairHint`。JD 成功而汇总失败时，界面必须明确显示部分成功。

## 9. UI 行为

飞书模式增加以下状态：

- 未授权 / 授权中 / 已授权 / 凭证过期
- 正在检查文档
- 新公司置顶计划 / 老公司追加计划
- 正在写入 JD / 正在校验 JD / 正在写入汇总 / 正在校验汇总
- 全部成功 / 部分成功 / 失败 / 结果未知

预览中所有解析字段继续可编辑。确认前不调用写接口。成功或失败后提供固定测试副本的“打开文档检查”按钮。

Boss 和脉脉模式的字段、按钮、消息和填写行为保持不变。

## 10. 测试与验收

### 10.1 自动化测试

- 现有 96 项测试全部继续通过。
- 遗留核心文件 SHA-256 完整性检查通过。
- PKCE：state、verifier、challenge、回调校验、取消授权、过期处理。
- API client：分页、401/403、限流、版本冲突、超时、log ID。
- Wiki 解析：固定 token、非 docx、错误文档标题。
- 块读取：父子树、文本归一化、目标标题缺失或重复、模板不完整。
- 计划：新公司置顶、老公司追加、岗位序号延续、重复公司和岗位拦截、并发版本变化。
- 渲染：Heading 1/2、链接、Callout、QuoteContainer、Bullet、缺失官网、缺失介绍、无加分项、控制字符和 URL 校验。
- 写入：JD 后校验、汇总后校验、部分成功、超时后的只读确认、拒绝重复写。
- Chrome/Edge 消息协议和授权适配器契约测试。

### 10.2 人工验收

只在指定测试副本执行：

1. 使用 CoFANCY 可糖的两个岗位作为全新公司写入，确认两个区域均置顶，JD 结构与现有模板一致。
2. 为 CoFANCY 可糖追加一个唯一的新岗位，确认没有重复公司块，岗位序号连续，两个区域都追加到原公司位置。
3. 分别在 macOS Chrome 和 macOS Edge 完成授权、检查、预览和至少一次真实写入。
4. 在 Boss 和脉脉现有发布页各完成一次烟雾测试，确认旧功能无变化。

纯插件 PKCE 兼容性验证失败不等于项目失败；它按第 3.2 节触发本地助手兜底。只有以下条件会阻止最终交付：四位用户均无测试文档编辑权限，或组织管理员拒绝所列的最小飞书权限。

## 11. 参考资料

- [飞书获取授权码与 PKCE](https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code?lang=zh-CN)
- [飞书刷新 user_access_token](https://open.feishu.cn/document/authentication-management/access-token/refresh-user-access-token?lang=zh-CN)
- [获取知识空间节点信息](https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/get_node?lang=zh-CN)
- [获取文档所有块](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/list?lang=zh-CN)
- [飞书文档块结构](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/docx-structure)
- [飞书文档 API 概述](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/docx-overview)
- [创建块](https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document-block-children/create)
- [Microsoft Edge Native Messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging)
