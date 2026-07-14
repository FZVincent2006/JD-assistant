# Codex 自动安装协议（macOS）

本文件是给另一台 Mac 上的 Codex 执行的安装协议。目标是在不要求使用者安装开发工具的前提下，把招聘 JD 发布助手安装到 Chrome 或 Microsoft Edge。

## 不可突破的边界

- 只允许两次人工确认：首次安装时在终端隐藏输入飞书 App Secret，以及在 Chrome/Edge 扩展管理页完成一次“加载已解压的扩展程序”安全确认。
- 不得在聊天中索取 App Secret，也不得把 Secret 写入命令、参数、文件、日志或安装回执。Secret 只能由使用者直接输入安装脚本打开的隐藏终端提示，并由原生助手写入 macOS Keychain。
- 不要安装 Node.js、Git、GitHub CLI、Swift、Xcode Command Line Tools 或其他开发依赖。安装器只使用 macOS 自带命令。
- 不要使用把网络内容直接送进 shell 的命令，不要修改浏览器 profile，不要安装企业策略，不要申请辅助功能、屏幕录制、输入监控、完全磁盘访问或管理员权限。
- 只接受仓库 `FZVincent2006/JD-assistant`、`distribution/release-channel.json` 固定的 GitHub Release，以及扩展 ID `mlhjjkclfiocgafhjdhoicghiabkeggg`。
- 不要绕过安装器的 SHA-256、包内文件、版本、构建提交或扩展 ID 校验。任何校验失败都应停止并原样报告。

## Codex 执行步骤

1. 确认当前设备是 macOS 13 或更高版本，并确认 Google Chrome 或 Microsoft Edge 至少安装了一个。不要改动任何浏览器用户数据。
2. 如果当前工作区已经是本仓库，直接复用。否则，把 GitHub 的 `main` 源码归档下载成一个文件，解压到临时目录后进入仓库根目录；不要执行远程脚本流。先完整读取本文件、`distribution/release-channel.json` 和 `scripts/install-from-github.sh`，并运行：

   ```bash
   bash -n scripts/install-from-github.sh
   ```

3. 判断使用者当前要使用的浏览器：仅一个浏览器正在运行时选择它；只有一个已安装时选择它；Chrome 和 Edge 同时可选但无法可靠判断时，只询问“安装到 Chrome 还是 Edge？”，不要猜测。
4. 先执行只读计划检查，把 `<browser>` 替换成 `chrome` 或 `edge`：

   ```bash
   bash scripts/install-from-github.sh --dry-run --browser <browser>
   ```

   只有输出包含固定扩展 ID、固定 Release 和预期的稳定安装目录时才继续。
5. 在可交互终端中执行正式安装：

   ```bash
   bash scripts/install-from-github.sh --browser <browser>
   ```

   首次安装或 Keychain 中没有 Secret 时，安装器会要求使用者在终端直接粘贴 App Secret；输入不会回显。此时暂停，让使用者完成隐藏输入。不得代填、读取或复述 Secret。重装默认保留已有 Secret；只有使用者明确要求轮换时才追加 `--replace-secret`。
6. 安装器必须以以下状态结束后才算通过文件安装阶段：

   ```text
   STATUS=browser_confirmation_required
   EXTENSION_ID=mlhjjkclfiocgafhjdhoicghiabkeggg
   EXTENSION_DIR=<稳定目录的绝对路径>
   ```

7. 使用可用的浏览器或桌面控制打开 `chrome://extensions` 或 `edge://extensions`。如果界面允许自动操作，打开开发者模式并发起“加载已解压的扩展程序”，选择输出的 `EXTENSION_DIR`；在浏览器要求安全确认时暂停给使用者。若 Codex 不能控制浏览器内部页面，则清楚显示下面的三步人工回退路径，不要尝试修改 profile：

   1. 打开对应浏览器的扩展管理页并开启“开发者模式”；
   2. 点击“加载已解压的扩展程序”；
   3. 选择安装器输出的 `EXTENSION_DIR`。

8. 在扩展管理页核对扩展已启用，且显示的 ID 恰好是 `mlhjjkclfiocgafhjdhoicghiabkeggg`。若 ID 不同或扩展报错，停止，不要继续飞书授权。
9. 打开招聘 JD 发布助手侧栏，选择“飞书文档”，让使用者用自己的飞书账号点击“授权飞书”，再点击“检查测试副本”。测试文档固定为：

   <https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv?fromScene=spaceOverview>

   只验证读取和模板识别；没有待写入语料时不要发起文档写入。

## 完成报告

逐项报告以下事实，不要用笼统的“安装成功”代替：

- 使用的 Release tag 与外层 SHA-256 已通过；
- 包内文件哈希、版本、构建提交和固定扩展 ID 已通过；
- 原生授权助手已安装，已有 Keychain Secret 是“保留”还是“本次由使用者配置”（不得报告 Secret 内容）；
- Chrome 或 Edge 已加载并启用扩展，页面 ID 已核对；
- 飞书授权和测试副本检查是否由使用者完成，以及失败时的原始错误。

若安装中断，保留安装器错误原文。不要删除稳定目录中的 `Extension.previous`，不要重复运行写入操作，也不要自行降低安全校验。
