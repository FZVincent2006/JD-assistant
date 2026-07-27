# 飞书 OpenAPI 招聘文档验收记录

更新日期：2026-07-27
分支：`codex/feishu-openapi-impl`  
固定正式文档：`RTWjwVZjri4uCUk0J8wcn2K3n6d`

本文档不得记录 access token、authorization code、PKCE verifier、App Secret、原始私有公司介绍或岗位正文。

## 自动门禁

- [x] `npm test`：41 个测试文件、285 项测试通过。
- [x] Boss/脉脉保护文件哈希通过。
- [x] `scripts/build-feishu-auth-helper.sh`：64 项 Swift 断言通过。
- [x] 原生助手包含 `x86_64` 与 `arm64` 两种架构。
- [x] `npm run build` 通过生产构建和 manifest 门禁。
- [x] 构建门禁确认 `nativeMessaging`、`APPLY_HEADING_NUMBERING` 和安全页面准备消息存在，并拒绝旧的合成飞书快捷键路径。
- [x] 生产 manifest 无剪贴板和 debugger 权限；飞书页面权限仅为 `https://zhenfund.feishu.cn/wiki/*`，且 content script 只注入顶层页面。
- [x] 公司 Heading 1 保持普通标题；如需 `1.` 自动编号，写入后由操作者在飞书中手动开启。
- [x] Boss/脉脉的六组 host 和 content-script match 保留。
- [x] 原生助手请求仅允许固定的 `APPLY_HEADING_NUMBERING`，不接受键位、坐标或脚本参数。
- [x] 自动化测试覆盖 `resume-new-company`，恢复路径不会再次创建岗位 JD。

## 每台 Mac 的本机权限

- [ ] Chrome/Edge 实际扩展 ID 已加入飞书应用回调并发布；不复用其他机器的未知 ID。
- [ ] 安装脚本配置 Keychain 后请求辅助功能权限。
- [ ] “系统设置 → 隐私与安全性 → 辅助功能”中已启用“飞书 JD 助手”（Bundle ID `cn.zhenfund.jd-assistant.feishu-helper`）。
- [x] TCC 日志确认辅助功能和 PostEvent 请求主体是助手 Bundle ID，不是 Codex、Chrome 或 Edge。
- [ ] 替换二进制后重新执行 `--check-accessibility`；必要时关闭并重新启用权限。
- [x] 不需要屏幕录制、输入监控、完全磁盘访问或管理员权限。

## Chrome 只读检查

- [ ] 加载当前 `dist` 并记录 Chrome 扩展 ID。
- [ ] 在飞书应用中发布对应 `https://<ID>.chromiumapp.org/feishu` 回调。
- [ ] 为该 origin 安装原生助手，并由用户在隐藏提示中配置 App Secret。
- [ ] 完成用户授权；侧栏只显示授权状态和过期时间，不显示 token。
- [ ] OpenAPI 读取固定正式招聘文档，确认两个目标标题各且仅有一个。
- [ ] 确认存在完整的 Portfolio、Heading 1/2、Callout、Heading 3、QuoteContainer 和 Bullet 模板。
- [ ] 检查目标公司是否已存在；若已存在，使用不冲突的验收公司名，不删除或覆盖现有内容。

## 新公司写入

- [ ] 计划模式为 `new-company`，岗位序号为 1、2。
- [ ] 岗位 JD 写入后 API 回读通过，随后才执行 Portfolio 写入。
- [ ] 公司是“岗位JD整理”后的首个根级 Heading 1，没有嵌套到上一家公司。
- [ ] 公司介绍 Heading 2、Callout、开放岗位 Heading 2 格式正确。
- [ ] 两个岗位标题为根级同级块，岗位正文位于各自 QuoteContainer 内。
- [ ] Portfolio Callout 首位为该公司，随后恰好两个岗位 Bullet。
- [ ] 两区公司名、岗位名、岗位数量、地点和招聘类型一致。
- [ ] 每个 Portfolio 岗位 Bullet 为蓝色链接，点击后跳转到同公司对应的岗位 JD 标题。

## CoFANCY JD-only 恢复

- [ ] 正式招聘文档页面可以关闭；恢复流程只使用 OpenAPI。
- [ ] 相同语料生成 `resume-new-company`，计划明确跳过 JD 创建。
- [ ] 只读回查确认 JD 完全匹配且不自动重复创建。
- [ ] Portfolio Callout 首位写入公司和两个带岗位标题锚点的链接。
- [ ] 完成后再次检查，文档中只有一个 CoFANCY JD 公司块和一个 Portfolio 公司块。

## 老公司追加

- [ ] 新输入使用唯一岗位名，计划模式为 `append-jobs`。
- [ ] 新岗位序号从现有最大序号加一，不按数组长度猜测。
- [ ] JD 和 Portfolio 都追加在原公司分组末尾。
- [ ] API 回读证明只有一个同名公司 Heading 1，且没有重复岗位。
- [ ] 新 Portfolio 岗位链接指向刚追加并回读取得的 JD 岗位标题块。

## 历史岗位链接补全

- [ ] 展开“维护已有岗位链接”并点击“检查岗位链接”；确认正式文档没有被修改。
- [ ] 预览显示总岗位数、已正确数量、待更新数量以及公司/岗位清单，不显示块 ID 或内部 URL。
- [ ] 人工抽查 CoFANCY 可糖两个岗位的预览匹配正确。
- [ ] 点击“确认补全 N 个岗位链接”并确认；API 只发送一次批量更新请求。
- [ ] 回读校验通过后，CoFANCY 的岗位链接分别跳转到对应岗位标题。
- [ ] 再次检查显示“全部岗位链接已正确”。
- [ ] 在预览后手动编辑文档，再尝试补全；应提示文档版本已变化且不发送 PATCH。
- [ ] 制造重复岗位或无法匹配项时整批停止，不修改任何安全子集。

## Edge 验收

- [ ] 加载同一 `dist` 并记录 Edge 扩展 ID。
- [ ] 发布 Edge 回调，更新本机原生助手 allowed origin。
- [ ] 完成授权与只读检查。
- [ ] 追加一个新的唯一岗位，并通过两阶段 API 回读。

## Boss / 脉脉烟测

- [ ] Boss：解析一个既有样例并填入标题、描述和要求字段；不点击最终发布。
- [ ] 脉脉：解析一个既有样例并填入标题、描述、经验、学历和行业；不点击最终发布。

## 结论

自动门禁和正式文档人工验收都完成后才宣称岗位链接功能交付；任何“结果未知”都必须先人工检查，不能重复提交。
