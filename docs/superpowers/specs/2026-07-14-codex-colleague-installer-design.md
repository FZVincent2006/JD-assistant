# Codex 同事安装入口设计

## 目标

让同事只需把 `https://github.com/FZVincent2006/JD-assistant` 交给自己电脑上的 Codex，并说明“安装这个招聘 JD 助手”，即可完成下载、校验、解压、本机授权助手安装和浏览器配置。

安装过程中只保留两个人工安全动作：

1. 在隐藏输入中填写一次飞书自建应用 App Secret。
2. 在 Chrome 或 Edge 首次加载或启用本地扩展时确认一次。

同事不需要安装 Node.js、Swift、Xcode Command Line Tools 或 GitHub CLI，也不需要理解扩展 ID、回调地址或 SHA-256。

## 非目标

- 不通过 Chrome Web Store、Edge Add-ons 或企业浏览器策略分发。
- 不绕过 Chrome/Edge 的本地扩展确认机制。
- 不部署服务器、常驻进程或开放端口。
- 不改变 Boss/脉脉字段填写逻辑。
- 不改变飞书 OpenAPI 的解析、计划、写入和校验逻辑。
- 不把 App Secret、访问令牌或刷新令牌写入仓库、Release、日志或命令参数。

## 方案选择

采用“GitHub Release 二进制包 + 仓库内 Codex 安装协议”。

不采用源码本机构建，因为它要求每位同事具备 Node.js 和 Swift 构建环境，失败面大且没有分发价值。不采用浏览器商店或企业强制安装，因为四人低频使用不值得承担审核、账号和企业管理成本。

## 用户入口

仓库 `README.md` 顶部增加“让 Codex 安装”入口，并给出唯一推荐指令：

```text
请安装这个仓库中的招聘 JD 发布助手：
https://github.com/FZVincent2006/JD-assistant
按照仓库的 CODEX_INSTALL.md 执行。除 App Secret 和浏览器安全确认外，其余步骤请自动完成并验证。
```

根目录新增 `CODEX_INSTALL.md`。它是给 Codex 读取的机器操作协议，不要求同事逐条执行。协议明确安装命令、允许的人工动作、失败停止条件、验证标准和最终交付话术。

Codex可以复用已有仓库 checkout；没有 checkout 或系统没有 `git` 时，使用 GitHub 的 `main` 源码归档下载到临时目录，先读取安装协议和脚本，再执行。不得要求同事安装 Git 或 Xcode Command Line Tools。

## 发布通道

仓库保存一个不含秘密的发布通道描述文件，字段包括：

- Release tag；
- GitHub Release asset 下载地址；
- asset SHA-256；
- 扩展 ID；
- 扩展版本；
- 构建提交；
- 最低支持的 macOS 版本。

安装器只下载该文件固定的 Release，不自动选择“latest”，避免预发布包、旧包或未来不兼容包被误装。更新发布时由维护者更新描述文件并通过测试。

当前固定扩展 ID 为：

```text
mlhjjkclfiocgafhjdhoicghiabkeggg
```

## 安装器

新增幂等入口 `scripts/install-from-github.sh`，只依赖 macOS 自带的 `bash`、`curl`、`ditto`、`shasum` 和 `open`。

### 参数

- `--browser auto|chrome|edge`，默认 `auto`；
- `--dry-run`，只输出计划且不下载、不写文件、不读取秘密；
- `--package <path>`，测试和离线恢复时使用已下载的 ZIP；
- `--replace-secret`，仅在管理员轮换 App Secret 时重新配置 Keychain。

### 浏览器选择

`auto` 按以下顺序选择：

1. 只有一个受支持浏览器正在运行时选择它；
2. 只安装了一个受支持浏览器时选择它；
3. 两者都安装且无法唯一判断时停止并要求 Codex重新使用明确的 `--browser` 参数。

无论选择哪个浏览器，本机 Native Messaging manifest 都继续写入 Chrome 和 Edge 的当前用户目录，因此日后切换浏览器无需重新输入 App Secret；新浏览器仍需首次加载扩展。

### 安装数据流

1. 检查 macOS、磁盘路径和支持的浏览器。
2. 从仓库读取固定发布通道描述。
3. 下载 ZIP 到临时目录，或使用 `--package` 指定的本地 ZIP。
4. 计算 SHA-256 并与描述文件严格比较。
5. 解压到临时目录，使用 macOS 自带工具完成包内完整性校验：
   - `VERSION.txt` 扩展 ID 一致；
   - `SHA256SUMS.txt` 覆盖包内所有文件；
   - 原生助手、安装脚本和扩展入口存在；
   - 每一个包内文件的 SHA-256 都一致。
6. 只查询本应用 Keychain 项是否存在，不读取或显示 Secret：
   - 首次安装时调用现有本机助手安装器，通过 `/dev/tty` 隐藏读取 App Secret；
   - 升级或修复安装时保留已有 Keychain 项，不再次提示；
   - 仅显式传入 `--replace-secret` 时重新提示并替换。
7. 将已验证的扩展目录原子替换到：

   ```text
   ~/Library/Application Support/ZhenFund JD Assistant/Extension
   ```

8. 写入不含秘密的安装回执，记录 Release tag、扩展版本、扩展 ID、构建提交和安装时间。
9. 打开所选浏览器的扩展管理页，并向 Codex返回唯一的扩展目录路径。
10. Codex使用可用的浏览器或桌面控制能力完成“加载已解压的扩展程序”；浏览器要求本人确认时暂停一次。
11. Codex验证浏览器显示的扩展 ID、扩展启用状态，以及本机 Native Messaging manifest 的允许来源。

## 原子更新与回退

- 下载、解压、校验和 App Secret 配置全部成功前，不替换当前扩展目录。
- 替换时将上一版本保留为一个备份目录；新版本通过浏览器 ID 校验后删除更早备份。
- 安装失败时输出失败阶段、保留路径和回退命令，不删除当前可用版本。
- 重复安装同一 Release 时允许重新校验并修复本机 manifest，不创建重复目录。
- App Secret 已在 Keychain 中时默认保留，升级不重复提示；只有 `--replace-secret` 才允许覆盖。

## 安全边界

- 禁止 `curl | bash`。Codex必须先取得仓库内容，再执行仓库中的已检视脚本。
- Release ZIP 先做外层 SHA-256，再做包内逐文件 SHA-256。
- 所有 GitHub URL 必须固定在 `FZVincent2006/JD-assistant`。
- 安装器不得读取浏览器 Cookie、密码、飞书文档内容或其他钥匙串项目。它只允许查询本应用 Keychain 项是否存在，不能读取其值。
- App Secret只通过 `/dev/tty` 传给签名的本机助手，脚本不保存变量、不回显、不写日志。
- 不申请管理员权限、辅助功能、屏幕录制、输入监控或完全磁盘访问。
- 浏览器不支持自动加载时，Codex停在扩展管理页并要求一次人工确认，不尝试修改浏览器 profile 数据或企业策略。

## Codex 完成标准

Codex只有同时确认以下条件后才可报告安装完成：

- ZIP 外层和包内校验全部通过；
- 固定扩展目录存在；
- Chrome/Edge Native Messaging manifest 指向已安装的 universal helper；
- manifest 的 `allowed_origins` 包含固定扩展 ID；
- 浏览器中的扩展 ID 完全等于固定 ID且已启用；
- App Secret已由本机助手成功写入当前用户 Keychain；
- 扩展能打开侧栏。

飞书账号授权与“检查测试副本”属于安装后的首次使用验收。Codex可以引导完成，但不得代替用户登录或读取 App Secret。

## 测试策略

### 单元测试

- 发布通道描述字段、GitHub 仓库、tag、URL、SHA-256 和固定扩展 ID 校验；
- Chrome/Edge 自动选择矩阵；
- 安装目录、备份目录和回执内容生成；
- 非 macOS、无浏览器、双浏览器歧义、错误 SHA-256 和错误扩展 ID拒绝。

### 脚本集成测试

- `--dry-run` 不修改 HOME、不访问 Keychain；
- 使用本地 `--package` 完成校验和临时解压；
- 首次安装提示 Secret，已有本应用 Keychain 项时跳过提示，`--replace-secret` 时重新提示；
- 同一版本重复执行保持幂等；
- 故障注入时保留旧扩展目录；
- Shell 语法检查和路径中包含空格、中文时正常工作。

### 回归与发布验证

- 现有 JavaScript、Swift、构建和 Boss/脉脉基线测试继续全部通过；
- universal helper 继续同时包含 `arm64` 和 `x86_64`；
- Release asset digest 与发布通道描述一致；
- 在一台 Chrome Mac 和一台 Edge Mac 各完成一次从仓库链接开始的人工验收。

## 仓库与发布流程

1. 实现和测试先进入当前 Draft PR。
2. 验证通过后更新 GitHub Release，得到最终 asset digest。
3. 将发布通道描述更新为最终 tag 和 digest，再运行完整测试。
4. PR 合并到 `main` 后，同事只接收仓库主页链接，不接收本地文件夹或临时路径。
5. 后续升级沿用同一链接和同一安装协议。
