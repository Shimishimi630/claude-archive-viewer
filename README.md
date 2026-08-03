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

