# 招聘 JD 发布助手

macOS 上的 Chrome/Edge 扩展，用于解析招聘 JD，并自动填入 Boss 直聘、脉脉，或通过飞书 OpenAPI 更新固定的招聘文档测试副本。

- Boss/脉脉沿用原有页面填充逻辑，最后的发布按钮仍由人工点击。
- 飞书采用“授权 → 检查 → 生成计划 → 人工确认 → 分阶段写入 → API 回读校验”的流程。
- 飞书只允许写入测试副本：<https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv?fromScene=spaceOverview>。
- 正式招聘文档没有写入入口。扩展只申请 `https://zhenfund.feishu.cn/wiki/*` 页面权限，用于在固定测试副本中为新公司的一级标题执行一次自动编号快捷键；运行时仍会校验完整测试副本 URL。

## 当前能力

- 解析一家公司的公司名、官网、公司介绍和多个岗位。
- 预览并编辑岗位名称、地点、招聘类型、工作内容、职位要求和可选加分项。
- 新公司同时置顶 Portfolio 汇总和岗位 JD；老公司只在原分组末尾追加岗位。
- 岗位 JD 使用飞书原生块：根级 Heading 1 公司名、灰色 Heading 2、公司介绍 Callout、岗位标题和 QuoteContainer。
- 先写岗位 JD，回读校验成功后才写 Portfolio；API 返回成功本身不视为完成。
- 网络超时只回读一次，不重试写入；结果会区分成功、部分完成、失败和未知。
- Boss/脉脉支持原有字段填充、iframe 回退、诊断和点击记录。

## 飞书应用配置（管理员一次性）

使用企业自建应用 `招聘 JD 发布助手`，App ID 为 `cli_aade4224b8789bef`。App Secret 不得写入仓库、`.env`、聊天或安装说明。

飞书应用只需要以下三个用户身份权限：

- `wiki:wiki:readonly`
- `docx:document:readonly`
- `docx:document:write_only`

管理员还需要：

1. 在应用可用范围中加入实际使用的四位同事，并发布新版本。
2. 为每一个实际 Chrome/Edge 扩展 ID 添加回调地址：

   ```text
   https://<32位扩展ID>.chromiumapp.org/feishu
   ```

3. 保留测试副本文档对这四位同事的阅读和编辑权限。

不同电脑、不同浏览器或重新生成的扩展 ID 可能不同；出现新 ID 时，只需补充对应回调地址并重新运行本机安装脚本，不需要部署服务器。

## 开发构建

要求 macOS 13+、Node.js，以及构建原生助手时可用的 Swift/Xcode Command Line Tools。

```bash
npm install
cat > .env.local <<'ENV'
VITE_FEISHU_APP_ID=cli_aade4224b8789bef
VITE_FEISHU_AUTH_MODE=native
ENV
npm run build
scripts/build-feishu-auth-helper.sh
```

`.env.local` 已被 Git 忽略。App ID 是公开标识；App Secret 只会在安装助手时通过隐藏输入写入当前 macOS 用户的 Keychain。

## 四人安装（无服务器）

可以由一位开发者生成 `dist` 和 universal 原生助手，再通过内部安全渠道把同一份构建包发给四位同事；也可以每个人在本机执行上面的构建步骤。

每台 Mac 的安装步骤：

1. 在 `chrome://extensions` 或 `edge://extensions` 开启开发者模式。
2. 选择“加载已解压的扩展程序”，加载 `dist`。
3. 复制页面显示的 32 位扩展 ID；同一台 Mac 同时使用 Chrome 和 Edge 时记录两个 ID。
4. 请管理员把对应的 `https://<ID>.chromiumapp.org/feishu` 加到飞书应用回调地址并发布。
5. 安装当前用户级原生助手。只使用一个浏览器时传一个 origin，同时使用两个浏览器时一起传入：

   ```bash
   scripts/install-feishu-auth-helper.sh \
     chrome-extension://<Chrome扩展ID>/ \
     chrome-extension://<Edge扩展ID>/
   ```

6. 脚本提示时粘贴 App Secret 并回车。输入不可见；Secret 只保存到当前用户 Keychain，service 为 `cn.zhenfund.jd-assistant.feishu`。
7. 重新加载扩展，选择“飞书文档”，点击“授权飞书”。

安装程序在用户目录中写入 Chrome 和 Edge 的 Native Messaging manifest，不需要管理员权限、后台服务、开放端口或常驻进程。

重新授权的日常成本较低：短期 token 过期后只需在侧栏再次点击“授权飞书”并确认；Keychain 中的 App Secret 不需要重复输入。只有 App Secret 被轮换、扩展 ID 改变、删除 Keychain 项或重装助手时，才需要重新配置本机助手。

卸载助手但保留 Keychain Secret：

```bash
scripts/install-feishu-auth-helper.sh --uninstall
```

同时删除本机 Keychain Secret：

```bash
scripts/install-feishu-auth-helper.sh --uninstall --delete-secret
```

## 飞书文档使用流程

1. 打开固定飞书测试副本并保持它为当前活动标签页，再打开扩展侧栏选择“飞书文档”。
2. 点击“授权飞书”或“重新授权”。
3. 点击“检查测试副本”，确认能读取文档版本和两区公司数量。
4. 粘贴并解析公司与岗位语料，检查可编辑预览字段。
5. 生成计划并确认新公司或追加岗位的位置。
6. 新公司写入时不要切换标签页：扩展先通过 OpenAPI 创建 JD，再在当前测试副本页面执行一次 `Command + Shift + 7`，最后通过 OpenAPI 确认编号后写入 Portfolio。
7. 点击“确认并写入测试副本”，在系统确认框中再次确认。

推荐输入格式：

```text
CoFANCY 可糖
公司介绍
CoFANCY 可糖是一个高端角膜接触镜品牌。

（1）品牌设计｜上海｜社招
工作内容：
- 建设品牌视觉。
职位要求：
- 具备 3 年左右设计经验。
加分项：
- 有美妆品牌经验。

（2）销售主管/分销主管｜深圳｜社招
工作内容：
- 管理分销渠道。
职位要求：
- 具备 5 年以上销售经验。
```

官网缺失时公司名写纯文本；公司介绍缺失时写一个“待补充”项目；加分项缺失时不创建该段。

## 正确写入验收标准

新公司的 API 回读必须同时证明：

- Portfolio 的 Callout 首位只有一个公司块，随后是所有岗位 Bullet。
- “岗位JD整理”后的首家公司是根级 Heading 1，不嵌套在上一家公司中。
- “公司介绍”和“开放岗位”是灰色 Heading 2。
- 公司介绍内容位于 Callout 内。
- 每个岗位标题是根级同级块；岗位正文位于紧随其后的 QuoteContainer 内。
- 岗位序号、标题、地点、招聘类型、岗位数量和两个区域的岗位名全部一致。

追加岗位时，还必须证明没有第二个同名公司块，岗位序号从现有最大序号加一，并且两个区域都追加在原公司分组末尾。

## 部分成功或结果未知时

扩展不会自动重试或撤销写入。

- “部分完成”不是统一的 JD 完成状态，必须按侧栏提示区分：
  - 显示“岗位 JD 区已确认写入”时，JD 已通过完整回读校验但 Portfolio 未完成；只修复 Portfolio 指定位置。
  - 诊断为“页面自动编号”时，JD 内容已经创建但自动编号状态与完整 JD 校验尚未确认，不能视为 JD 完成；Portfolio 不会写入。不要重复提交；先删除本次不完整公司块或按提示人工修复，再重新检查文档版本。
- “结果未知”表示写请求可能已经被服务器接受，但回读失败。不要再次点击写入；先人工打开测试副本确认。
- “岗位 JD 校验失败”时，Portfolio 不会继续写入。按提示检查公司 Heading 1、Callout、岗位标题和 QuoteContainer。
- 修复或确认后重新点击“检查测试副本”，再生成一份基于最新 revision 的计划。

## Boss / 脉脉

1. 打开 Boss 或脉脉职位发布页。
2. 在侧栏选择对应平台，粘贴 JD 并解析。
3. 检查字段后点击“填入当前页面”。
4. 找不到字段时使用“诊断当前页面”或点击记录功能；最终发布仍由人工完成。

飞书 OpenAPI 功能不修改 `src/lib/jdParser.js` 和 `src/content/formFiller.js`。构建前会校验这两个文件的基线哈希。

## JD Skill 安装

仓库同时包含 `skills/jd-skill`，用于把 JD 图片、截图或 OCR 文本整理成插件可解析的模板。

```bash
bash scripts/install-jd-skill.sh
```

安装后重新打开 Codex 或新开会话，并使用 `$jd-skill`。

## 验证

```bash
npm test
npm run build
```

`npm run build` 会同时验证：

- Boss/脉脉受保护文件哈希不变。
- `dist/content.js` 没有 ES module import。
- manifest 不含剪贴板或 `debugger` 权限；飞书页面注入仅匹配 `https://zhenfund.feishu.cn/wiki/*`，运行时只接受固定测试副本。
- Boss/脉脉 host 和 content-script matches 完整保留。
- 后台构建包含全部飞书授权、检查、计划和写入消息。

## 回退

稳定的 Boss/脉脉回退基线保存在分支 `codex/pre-feishu-openapi-baseline`。需要紧急停用飞书新功能时，在干净工作区执行：

```bash
git switch codex/pre-feishu-openapi-baseline
npm install
npm run build
```

不要用 `git reset --hard` 覆盖同事的未提交修改。
