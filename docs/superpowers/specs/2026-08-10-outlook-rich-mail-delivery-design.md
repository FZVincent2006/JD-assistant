# Outlook 正文与简历附件飞书推送设计

## 目标

在现有 Outlook 邮件列表扫描、基线、去重和重试机制之上，增加可选的增强投递模式：

1. 继续由 `partner.outlook.cn` 内容脚本检测目标文件夹中的新邮件，不点击邮件行，不改变已读状态。
2. 仅对已判定为新个人投递的邮件，通过 Microsoft Graph 中国区获取正文和附件。
3. 通过飞书自建应用机器人发送正文卡片和简历文件。
4. 保留旧的自定义机器人 Webhook 主题提醒作为兼容模式。

## API 与身份

- Microsoft Graph 根地址固定为 `https://microsoftgraph.chinacloudapi.cn`。
- Microsoft 身份平台固定为 `https://login.chinacloudapi.cn/{tenant}`。
- Outlook 使用授权码 + PKCE，不使用客户端密钥；权限为 `Mail.Read`、`Mail.Read.Shared` 和 `offline_access`。
- 飞书应用短期 `tenant_access_token` 由本机 Native Messaging 助手使用 Keychain 中既有 App Secret 获取；Secret 不进入扩展进程、源码或日志。
- 飞书应用需开启机器人能力、消息发送和文件资源权限，并加入目标群。

## 数据流

```text
Outlook 列表扫描
→ 新邮件去重键
→ Graph 在目标文件夹中匹配主题、发件人与收件时间
→ 正文转纯文本
→ 下载白名单简历到内存
→ 飞书正文卡片
→ 上传并发送每份简历
→ 持久化完成部件并标记邮件已投递
```

队列仍不保存正文、附件名称或附件内容。每完成正文卡片或一份附件消息后，队列只记录部件键；
重试时跳过已经成功的部件，避免部分失败造成重复消息。

## 限制

- 仅发送 PDF、DOC、DOCX；忽略内嵌图片和其他文件。
- 飞书单文件上限 30 MB；单封邮件内存下载总量上限 60 MB。
- 正文最多 12,000 字，超出时明确标记截断。
- Graph 消息匹配使用主题、发件人和十分钟内的收件时间窗口；找不到唯一近期候选时失败并进入重试，不猜测另一封邮件。
- 只支持固定邮箱 `recruiting@zhenfund.com` 和固定文件夹 `个人投递（需提醒）`。

## 隐私与日志

- 正文和附件二进制只存在于一次投递调用的内存中。
- 诊断事件只记录状态、数量和脱敏错误码。
- OAuth 刷新凭证保存在 `chrome.storage.local`；飞书应用 Secret 保存在 macOS Keychain。
- 目标群必须是仅包含获准处理招聘数据人员的私密群。
