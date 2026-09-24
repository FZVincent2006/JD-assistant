# Codex 安装指引

本指引用于在 macOS 上加载维护者提供的招聘 JD 助手分发包。只操作扩展目录和 Codex Skill 目录，不修改浏览器 profile，不请求管理员权限。

## 安装扩展

1. 确认分发包来自仓库维护者，并且包含 `扩展/manifest.json`、`扩展/content.js`、`VERSION.txt` 和 `SHA256SUMS.txt`。
2. 在安装包根目录验证文件哈希：

   ```bash
   shasum -a 256 -c SHA256SUMS.txt
   ```

3. 检查 `扩展/manifest.json` 的 `content_scripts` 仅匹配 Boss 直聘、看准和脉脉招聘域名，且没有 `background` 服务工作线程。
4. 在 Chrome 打开 `chrome://extensions`，或在 Edge 打开 `edge://extensions`；开启开发者模式，选择“加载已解压的扩展程序”，并选中分发包里的 `扩展` 文件夹。
5. 确认扩展已启用。然后打开招聘平台发布职位页面，使用侧栏解析、检查并填入字段；最终审核并发布由使用者手动完成。

若哈希校验失败、清单与上述范围不符或浏览器报告错误，停止安装并把具体错误交给维护者。不要跳过校验或修改浏览器用户数据。

## 安装 JD Skill

仓库源码可用时，在仓库根目录执行：

```bash
bash scripts/install-jd-skill.sh
```

或将 `skills/jd-skill` 目录复制到 `$CODEX_HOME/skills/jd-skill`（未设置 `CODEX_HOME` 时为 `~/.codex/skills/jd-skill`）。安装后重启 Codex 或新开会话，并使用 `$jd-skill`。

## 发布包版本

`distribution/release-channel.json` 固定指向一个已发布的 GitHub Release。更新扩展后，先运行 `scripts/build-colleague-distribution.sh` 并完成包验收，再由维护者发布新 Release、更新固定版本信息。不要把当前固定的旧版本误认为包含未发布的源码改动。
