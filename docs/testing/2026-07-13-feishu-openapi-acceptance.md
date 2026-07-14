# 飞书 OpenAPI 招聘文档验收记录

日期：2026-07-14
分支：`codex/feishu-openapi-impl`  
固定测试副本：`LlhrwSLIvilANZk1opwcQGlUnNv`

本文档不得记录 access token、authorization code、PKCE verifier、App Secret、原始私有公司介绍或岗位正文。

## 自动门禁

- [x] `npm test`：32 个测试文件、233 项测试通过。
- [x] Boss/脉脉保护文件哈希通过。
- [x] `scripts/build-feishu-auth-helper.sh`：49 项 Swift 断言通过。
- [x] 原生助手包含 `x86_64` 与 `arm64` 两种架构。
- [x] `npm run build` 通过生产构建和 manifest 门禁。
- [x] 构建门禁确认 `nativeMessaging`、`APPLY_HEADING_NUMBERING` 和安全页面准备消息存在，并拒绝旧的合成飞书快捷键路径。
- [x] 生产 manifest 无剪贴板和 debugger 权限；飞书页面权限仅为 `https://zhenfund.feishu.cn/wiki/*`，且 content script 只注入顶层页面。
- [ ] 在真实测试副本中确认扩展生成的 `Command + Shift + 7` 能让新公司 Heading 1 出现自动编号。
- [ ] OpenAPI 回读确认 `sequence: "auto"` 后才写入 Portfolio。
- [x] Boss/脉脉的六组 host 和 content-script match 保留。
- [x] 原生助手请求仅允许固定的 `APPLY_HEADING_NUMBERING`，不接受键位、坐标或脚本参数。
- [x] 自动化测试覆盖 `resume-new-company`，恢复路径不会再次创建岗位 JD。

## 每台 Mac 的本机权限

- [ ] Chrome/Edge 实际扩展 ID 已加入飞书应用回调并发布；不复用其他机器的未知 ID。
- [ ] 安装脚本配置 Keychain 后请求辅助功能权限。
- [ ] “系统设置 → 隐私与安全性 → 辅助功能”中已启用 `feishu-auth-host`。
- [ ] 替换二进制后重新执行 `--check-accessibility`；必要时关闭并重新启用权限。
- [x] 不需要屏幕录制、输入监控、完全磁盘访问或管理员权限。

## Chrome 只读检查

- [ ] 加载当前 `dist` 并记录 Chrome 扩展 ID。
- [ ] 在飞书应用中发布对应 `https://<ID>.chromiumapp.org/feishu` 回调。
- [ ] 为该 origin 安装原生助手，并由用户在隐藏提示中配置 App Secret。
- [ ] 完成用户授权；侧栏只显示授权状态和过期时间，不显示 token。
- [ ] OpenAPI 读取固定测试副本，确认两个目标标题各且仅有一个。
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

## CoFANCY JD-only 恢复

- [ ] 浏览器只保留一个固定测试副本标签页并置于前台。
- [ ] 相同语料生成 `resume-new-company`，计划明确跳过 JD 创建。
- [ ] 只发送一次本机编号请求；若响应未知，只读回查且不自动重发。
- [ ] OpenAPI 确认公司 Heading 1 为 `sequence: "auto"` 后，才在 Portfolio Callout 首位写入公司和两个岗位。
- [ ] 完成后再次检查，文档中只有一个 CoFANCY JD 公司块和一个 Portfolio 公司块。

## 老公司追加

- [ ] 新输入使用唯一岗位名，计划模式为 `append-jobs`。
- [ ] 新岗位序号从现有最大序号加一，不按数组长度猜测。
- [ ] JD 和 Portfolio 都追加在原公司分组末尾。
- [ ] API 回读证明只有一个同名公司 Heading 1，且没有重复岗位。

## Edge 验收

- [ ] 加载同一 `dist` 并记录 Edge 扩展 ID。
- [ ] 发布 Edge 回调，更新本机原生助手 allowed origin。
- [ ] 完成授权与只读检查。
- [ ] 追加一个新的唯一岗位，并通过两阶段 API 回读。

## Boss / 脉脉烟测

- [ ] Boss：解析一个既有样例并填入标题、描述和要求字段；不点击最终发布。
- [ ] 脉脉：解析一个既有样例并填入标题、描述、经验、学历和行业；不点击最终发布。

## 结论

当前结论：自动门禁通过；真实浏览器授权、测试副本写入和 API 回读验收待完成。在以上未完成项通过前，不宣称飞书功能交付完成，也不开放正式文档写入。
