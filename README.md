# GitHub Pages 加密预览包

此目录可直接作为一个独立 GitHub 仓库。`site/` 只包含 AES-256-GCM 加密分片和静态阅读器，不包含恢复密钥、SQLite、明文 JSON 或原始归档。

## 推荐发布方式

1. 在 GitHub 新建仓库，例如 `claude-archive-viewer`。加密站点可放公开仓库；恢复密钥必须继续只保存在本机。
2. 在此目录执行：

   ```powershell
   git init -b main
   git add .
   git commit -m "Deploy encrypted Claude archive"
   git remote add origin https://github.com/你的用户名/claude-archive-viewer.git
   git push -u origin main
   ```

3. 打开仓库 **Settings → Pages**，将 **Source** 设为 **GitHub Actions**。
4. 等待 `Deploy encrypted Claude archive` 工作流完成。地址通常是：
   `https://你的用户名.github.io/claude-archive-viewer/`
5. 使用本机 `deploy/edgeone-v3/recovery-key.txt` 解锁。该密钥与上一版一致。

## 更新数据

以后重新生成 `site/` 后，只需提交并推送，GitHub Actions 会自动更新 Pages。不要把 `recovery-key.txt`、`archive/`、数据库或构建审计报告复制进本仓库。

当前版本：222 个会话、12,134 条消息、139 个明确缺口。

## Claude API 新聊天

页面左侧的“新聊天”可以直接连接用户自己的 Anthropic API Key。只有新聊天内容会发送到 `api.anthropic.com`，恢复档案不会作为上下文上传。模型列表由 Anthropic API 动态返回，不在站点中固定旧模型。

API Key 永远不应提交到本仓库。默认只保存在当前浏览器会话；只有用户主动勾选“在这台设备上记住 API Key”时才会写入该设备的浏览器本地存储。公共站点已通过 Content Security Policy 将联网范围限制为本站和 Anthropic API。
