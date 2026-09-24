# 招聘 JD 发布助手

本仓库包含两项相互独立的工具：Chrome/Edge 扩展用于解析 JD 并辅助填写 Boss 直聘、脉脉招聘表单；`jd-skill` 用于把 JD 图片、截图或 OCR 文本整理成结构化招聘信息。

## 扩展使用

1. 打开扩展侧栏，选择“Boss 直聘”或“脉脉”。
2. 粘贴完整 JD，点击“解析 JD”。
3. 检查并按需修改解析出的职位、薪资、地点、经验、学历和职位描述。
4. 在对应平台的职位发布页面点击“填入当前页面”。
5. 检查页面内容并由招聘人员手动发布。

Boss 支持招聘类型、关键词等字段；脉脉支持公司名、邮箱等字段。页面结构异常时，可使用“诊断当前页面”和“开始记录点击”协助排查。扩展保留 Boss 表单 iframe 回退。

扩展只对当前支持的招聘平台页面执行填充。最终字段复核和发布由使用者负责；助手不会替用户提交职位。

## 安装扩展

使用本仓库构建的发布包时，先解压完整目录，再按以下步骤操作：

1. 在 Chrome 打开 `chrome://extensions`，或在 Edge 打开 `edge://extensions`。
2. 开启“开发者模式”，点击“加载已解压的扩展程序”。
3. 选择发布包中的 `扩展` 文件夹，并确认扩展已启用。

仅使用经维护者确认、与当前源码对应的发布包。发布包构建方式见下文；仓库 `distribution/release-channel.json` 指向已发布的固定版本，发布新代码后需先生成并发布新版本，再更新该文件，不能把旧 Release 当成本次精简版本安装。

## JD Skill

安装独立技能到当前 Codex 用户目录：

```bash
bash scripts/install-jd-skill.sh
```

安装后重启 Codex 或新开会话，然后使用 `$jd-skill`。Skill 可处理 JD 截图、图片和粘贴文本；扩展与 Skill 可单独使用。

## 开发与发布

需要 Node.js：

```bash
npm ci
npm test
npm run build
```

`npm run build` 会生成 `dist/`，其中包含扩展侧栏、Boss／脉脉内容脚本及所需静态资源。加载 `dist/` 可在本地验收。

macOS 上生成同事分发包：

```bash
scripts/build-colleague-distribution.sh
```

分发包包括扩展、`skills/jd-skill`、安装说明、版本信息和 SHA-256 校验清单。构建脚本会先运行测试、构建和包校验。

## 项目结构

- `src/sidepanel/`：平台选择、JD 编辑与字段填写界面。
- `src/content/`：表单填充、页面诊断和点击记录。
- `src/lib/jdParser.js`：粘贴 JD 的结构化解析。
- `skills/jd-skill/`：可独立安装的 Codex Skill。
- `scripts/install-jd-skill.sh`：安装 Skill。
- `scripts/build-colleague-distribution.sh`：构建并校验 macOS 分发包。
- `tests/`：解析、表单填充、权限清单、安装包和精简范围回归测试。
