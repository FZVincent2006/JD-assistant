# 飞书 OpenAPI 招聘文档验收记录

日期：2026-07-13  
分支：`codex/feishu-openapi-impl`  
固定测试副本：`LlhrwSLIvilANZk1opwcQGlUnNv`

本文档不得记录 access token、authorization code、PKCE verifier、App Secret、原始私有公司介绍或岗位正文。

## 自动门禁

- [x] `npm test -- --run`：25 个测试文件、167 项测试通过。
- [x] Boss/脉脉保护文件哈希通过。
- [x] `scripts/build-feishu-auth-helper.sh`：26 项 Swift 断言通过。
- [x] 原生助手包含 `x86_64` 与 `arm64` 两种架构。
- [x] `npm run build` 通过生产构建和 manifest 门禁。
- [x] 生产 manifest 无剪贴板、debugger、飞书页面 host 或飞书 content-script match。
- [x] Boss/脉脉的六组 host 和 content-script match 保留。

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
