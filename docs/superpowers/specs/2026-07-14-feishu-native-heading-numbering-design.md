# 飞书公司标题本机真实按键编号设计

## 状态与结论

本设计替代 `2026-07-14-feishu-page-numbering-fallback-design.md` 中由内容脚本分发合成 `KeyboardEvent` 的方案。测试副本已经证明，飞书编辑器不会接受该事件完成公司 Heading 1 自动编号：`CoFANCY 可糖` 的岗位 JD 内容已经写入，但目录仍显示无编号标题，原第一家公司仍为 `1. 闪念贝壳`，Portfolio 因安全闸门没有写入。

新版方案保留 OpenAPI 负责结构化写入和最终校验，只把飞书没有开放 API 的“开启 Heading 1 自动编号”交给现有 Swift 本机助手。助手通过 macOS 辅助功能把焦点从扩展侧栏切回当前 Chrome/Edge 网页区域，并发送一次真实的 `Command + Shift + 7`。只有 OpenAPI 回读确认公司标题的 `sequence` 为 `auto` 后，流程才继续写 Portfolio。

## 目标与范围

### 包含

- 为全新公司在岗位 JD 区创建的 Heading 1 开启飞书自动编号。
- 支持 macOS 13 及以上的 Chrome 和 Microsoft Edge。
- 复用现有 Native Messaging Swift 助手，不增加服务器。
- 首次使用时请求一次 macOS“隐私与安全性 → 辅助功能”权限。
- 增加对“JD 已完整写入、Portfolio 尚未写入”的精确恢复模式，修复当前 CoFANCY 半成品而不重复创建 JD。
- 保留 OpenAPI 分阶段回读、重复岗位保护和固定测试副本限制。

### 不包含

- 不开放正式文档写入；唯一可写目标仍为：
  `https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv`
- 不使用 `debugger`、系统剪贴板、AppleScript、飞书未公开接口或 DOM 合成键盘事件。
- 不授予录屏、输入监控或完全磁盘访问权限。
- 不允许本机助手接收任意按键、任意坐标、任意进程名或任意网址。
- 不自动删除、覆盖或回滚已经写入的文档内容。
- 不修改 Boss/脉脉解析、字段映射、填表逻辑或消息协议。

## 架构

### 1. 页面准备器

现有飞书内容脚本继续承担只读定位和页面内聚焦，但不再生成键盘事件。后台向当前窗口的活动标签页发送准备请求后，页面准备器必须确认：

- URL 规范化后与固定测试副本完全一致。
- 文档处于可编辑状态。
- 虚拟滚动文档中只存在一个文本与公司名精确匹配的根级 `docx-heading1-block`。
- 目标不是高亮块或引用块中的标题，也不是“岗位JD整理”“公司介绍”“开放岗位”等模板标题。
- 目标当前没有 `.heading-order`；若已经编号则直接返回 `already-numbered`，不执行快捷键。

准备器将目标滚动到可见区域，聚焦其 `contenteditable` 并把折叠光标放到标题末尾，然后返回“准备完成”。页面内不产生任何文字或结构修改。

`already-numbered` 是安全的无操作分支，不作为重新切换编号的理由；后台仍必须通过 OpenAPI 确认 `sequence: "auto"` 后才能继续。

### 2. 本机编号器

Swift Native Messaging 助手新增固定请求类型 `APPLY_HEADING_NUMBERING`。该请求不携带按键、坐标、网址或正文，只代表一个预定义操作。

收到请求后，本机编号器按顺序执行：

1. 检查辅助功能/事件投递权限；未授权时请求系统显示授权入口并返回 `accessibility-not-granted`，不发送事件。
2. 检查当前前台进程的 Bundle ID，只允许 Google Chrome（`com.google.Chrome`）或 Microsoft Edge（`com.microsoft.edgemac`）。
3. 通过 macOS Accessibility API 获取当前浏览器的聚焦窗口，并唯一定位活动网页的 `AXWebArea`。无法唯一确定或无法切回网页焦点时停止。
4. 将键盘焦点从扩展侧栏切回活动网页区域。页面准备器此前设置的 DOM 光标必须仍指向目标标题。
5. 通过 CoreGraphics 发送一次固定的 `Command + Shift + 7` key-down/key-up 组合。
6. 返回“事件已发送”。本机助手不重试，也不判断飞书是否最终接受快捷键。

Native Messaging manifest 继续只允许安装脚本登记的扩展 origin 调用。Swift 请求路由严格区分既有 `EXCHANGE_CODE` 与新增编号请求，授权交换行为和 Keychain Secret 行为保持不变。

### 3. OpenAPI 编排器

OpenAPI 是最终事实来源。本机助手返回后，后台进行有限次数的只读回读：

- 若唯一公司 Heading 1 的 `sequence` 为 `auto`，并且 JD 其余结构仍通过完整校验，则把 JD 阶段标记为完成并写 Portfolio。
- 若本机响应丢失或助手崩溃，先回读文档；已经编号则继续，未编号则停止，绝不自动重发快捷键。
- 若轮询超时、标题结构变化或出现多个同名标题，停止 Portfolio 写入。

因此真实快捷键至多发送一次，Portfolio 仅在编号得到 OpenAPI 语义确认后才会写入。

## 写入与恢复流程

### 全新公司

1. OpenAPI 预检并生成 `new-company` 计划。
2. 创建完整岗位 JD 公司块。
3. 回读并校验公司介绍、岗位标题、引用块和全部正文；暂不要求编号。
4. 页面准备器定位并聚焦公司 Heading 1。
5. 本机编号器切回网页焦点并发送一次真实快捷键。
6. OpenAPI 回读确认 `sequence: "auto"`。
7. 写入 Portfolio 最前面，并再次回读校验。

### 老公司追加岗位

保持现有 `append-jobs` 流程，不创建公司 Heading 1、不调用页面准备器或本机编号器。重复岗位继续在预检阶段拦截。

### 恢复未完成的新公司

新增 `resume-new-company` 计划，用于当前 CoFANCY 以及未来同类部分成功状态。只有同时满足下列条件才允许恢复：

- 岗位 JD 区恰好存在一个同名根级公司 Heading 1。
- Portfolio 区不存在该公司。
- 公司介绍、岗位数量、岗位顺序、岗位标题和每个固定正文段与当前草稿完整匹配。
- 匹配时只忽略无语义的空白、项目符号表现和全半角分隔差异；正文增删、岗位增删或顺序变化均视为不匹配。
- 文档中没有第二个同名公司或同名岗位冲突。

恢复计划绝不再次创建 JD：

- 标题未编号时，只执行准备、一次本机快捷键、OpenAPI 编号校验和 Portfolio 写入。
- 标题已经自动编号时，跳过快捷键，直接完成结构校验并写 Portfolio。
- 任一结构不完全匹配时无写入失败，并明确指出人工检查位置。

侧栏在部分成功后显示“继续编号并写入 Portfolio”。扩展被重载后，用户也可以重新粘贴相同草稿并生成恢复计划；两种入口共用同一套精确匹配规则。

## 权限、安装与升级

- 继续使用 `~/Library/Application Support/ZhenFund JD Assistant/feishu-auth-host` 的稳定安装路径，以及现有 Chrome/Edge Native Messaging manifests。
- 构建产物继续为 arm64 与 x86_64 合并的 universal binary。
- 安装脚本在首次安装或本机助手升级后触发辅助功能权限检查；未授权时由 macOS 引导用户前往“隐私与安全性 → 辅助功能”。
- 授权对象是 `feishu-auth-host`，不是整个浏览器；不申请录屏、输入监控或完全磁盘访问。
- 正常使用期间权限持续有效。替换本机助手二进制、修改代码签名或重置 macOS 隐私设置后，系统可能要求重新启用一次权限；界面必须把这种情况与飞书 OAuth 重新授权区分开。
- Chrome 和 Edge 使用相同助手二进制，但各自仍需存在 Native Messaging manifest。四台 Mac 分别完成一次安装和辅助功能授权。

## 错误处理与状态

新增或细化以下安全原因码：

- `accessibility-not-granted`：本机助手尚未获得辅助功能权限。
- `unsupported-front-app`：前台不是允许的 Chrome/Edge。
- `web-area-missing`：无法唯一定位活动网页区域。
- `web-area-focus-failed`：无法把焦点从侧栏切回网页。
- `native-event-failed`：未能构造或投递固定快捷键事件。
- `native-result-unknown`：本机消息结果丢失；必须先 OpenAPI 回读，禁止重发。
- `jd-numbering-verify`：事件已发送，但 OpenAPI 未确认 `sequence: "auto"`。
- `resume-mismatch`：现有 JD 与草稿不完全匹配，禁止恢复写入。

页面定位、本机编号或 OpenAPI 编号验证失败时，Portfolio 均不写入。界面显示已完成区域、失败阶段和可操作修复提示，但不回传 DOM、正文、令牌、App Secret 或内部堆栈。

## 安全边界

- 本机请求不接受用户提供的按键、坐标、应用名或脚本内容，不能演变为通用键盘自动化器。
- URL、唯一公司标题和编辑状态由扩展在发送本机请求前验证；本机助手再次验证前台浏览器类型与唯一网页区域。
- 编号事件固定为一次；任何不确定结果先只读检查，不自动重试。
- Portfolio 永远晚于 JD 完整结构校验和自动编号语义校验。
- 正式文档仍被配置层拒绝，不能通过界面或请求参数覆盖。
- 现有 App Secret 继续只存储在 macOS Keychain，不进入扩展存储、日志或文档。

## 测试策略

### Swift 单元测试

- 严格解码 `EXCHANGE_CODE` 与 `APPLY_HEADING_NUMBERING`，拒绝未知类型和额外可执行参数。
- 未获权限时只返回 `accessibility-not-granted`，事件投递器调用次数为零。
- 只接受 Chrome/Edge Bundle ID。
- 网页区域缺失、重复或无法聚焦时停止。
- 成功路径只构造一次固定 `Command + Shift + 7` key-down/key-up。
- 编号功能失败不影响原有 OAuth 交换与 Keychain 测试。

### JavaScript 单元与集成测试

- 页面准备器精确定位、虚拟滚动、已编号短路及错误 URL 拒绝。
- 后台顺序严格为：JD 校验 → 页面准备 → Native Messaging → OpenAPI 编号回读 → Portfolio。
- 本机结果未知时先回读且不重发。
- `resume-new-company` 精确匹配成功、已编号短路、正文差异、岗位差异、重复公司和 Portfolio 已存在等分支。
- 老公司追加不调用本机编号器。
- 权限错误和各阶段中文诊断。
- Manifest 保持 Boss/脉脉原匹配，且 nativeMessaging 权限只在 native 构建模式出现。

### 回归与构建

- 全部现有 JavaScript 测试继续通过。
- Swift helper 全部测试通过并成功生成 universal binary。
- `npm run verify:legacy` 通过，证明 Boss/脉脉受保护文件未变化。
- `npm run build` 成功。
- 构建产物同步到用户可见扩展目录后再进行真实验收。

## 测试副本验收

1. 在当前 CoFANCY 的“JD 已写入、Portfolio 未写入”状态上生成恢复计划。
2. 首次触发辅助功能授权，授权后继续；确认没有第二个 CoFANCY JD，公司标题显示自动编号，原公司序号自动顺延，Portfolio 正确置顶。
3. 为 CoFANCY 追加一个新岗位，确认未创建第二个公司标题、未再次发送编号快捷键，JD 与 Portfolio 均追加到原公司位置。
4. 再以一个全新测试公司走完整新公司流程，确认无需人工按键即可完成 JD 编号和 Portfolio 写入。
5. 分别在 Edge 和 Chrome 至少完成一次编号路径验证；其他两台 Mac 只需完成安装、权限自检和一条受控测试。

## 成功标准

- 新公司在岗位 JD 区以飞书 Heading 1 自动编号形式出现，而不是写死的 `1.` 或普通有序列表。
- 插入最前面后，后续公司编号由飞书自动重排。
- 公司介绍高亮块、开放岗位二级标题、岗位引用格式和 Portfolio 高亮块格式保持现有正确实现。
- 当前部分写入可以安全恢复，不重复 JD，不遗漏 Portfolio。
- 任一不确定状态停止后续写入并可安全续跑。
- Boss/脉脉行为和构建产物保持回归通过。
