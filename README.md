# Gym Check-in

手机优先的训练打卡 PWA。前端是静态网页，后端是 `/api`，本地开发使用 JSON 文件数据库，Azure 生产环境使用 Cosmos DB serverless。

## 本地运行

```bash
cd zyGym
node tools/dev-server.mjs
```

打开 `http://localhost:5174`。

如果你的 shell 里有 `npm`，也可以用 `npm run dev`；当前第一版本地运行不需要安装依赖。

本地记录会写到：

```text
zyGym/data/gym-checkin.local.json
```

## 当前功能

- 今日训练自动显示：推 / 腿 / 拉 / Zone 2 / 普拉提 / 休息
- 今日训练翻卡流：当前动作、当前组、完成一组、先去下个、有问题
- 训练动作 guide：器械名、照片编号、组数次数、动作重点
- 设备库：每台机器的状态、个人设置、备注、1-2 个替代机器
- 今日训练临时调整：先去下个项目、换到预设替代机器
- 每组记录：重量、次数、RIR、完成状态
- 低疲劳模式：保留主项，减少补量组
- 根据上次记录提示：先补次数或下次加一档
- 历史记录
- JSON / CSV 导出
- PWA 离线缓存
- Microsoft 登录：生产环境要求登录后进入；API 会按 Microsoft principal 分区

## Azure 架构

推荐：

```text
Azure Storage Static Website
  web/ 静态前端

Azure Functions
  api/ Functions backend
  system-assigned managed identity

Azure Cosmos DB for NoSQL
  serverless account
  database: gymcheckin
  container: items
  partition key: /userId
```

不用 Azure Static Web Apps database connections。Microsoft Learn 上这个功能已经有退役通知，结束日期是 2025-11-30；这个项目直接用 Functions API 访问数据库。

不用 Cosmos key / connection string。前端只是静态文件，API 跑在独立 Function App 里。Function App 开 system-assigned managed identity，然后给它 Cosmos DB data-plane RBAC 的 `Cosmos DB Built-in Data Contributor`。

当前 Azure 部署：

```text
Frontend: https://gym.zy8095.io/
Azure origin: https://stzygymzy8095.z5.web.core.windows.net/
API:      https://func-zygym-zy8095.azurewebsites.net
Cosmos:   cosmos-zygym-zy8095 / gymcheckin / items
RG:       zyGym
```

`gym.zy8095.io` 由 Cloudflare proxied CNAME + Worker route 提供。Worker 源码在 [infra/cloudflare-worker.js](/Users/zy8095/Documents/Codex/2026-04-23/chat/zyGym/infra/cloudflare-worker.js:1)，它只代理静态前端到 Azure Storage origin；API 仍直接走 Azure Function。

## Azure 配置

前端通过 `web/config.json` 决定 API base URL：

```json
{
  "apiBaseUrl": "https://func-zygym-zy8095.azurewebsites.net",
  "useCredentials": true,
  "requireAuth": true
}
```

本地开发可以保留空字符串，让前端请求同源 `/api`。

Cosmos DB 容器建议：

| 设置 | 值 |
|---|---|
| API | NoSQL |
| Capacity mode | Serverless |
| Database | `gymcheckin` |
| Container | `items` |
| Partition key | `/userId` |

在 Function App 的 Configuration / Application settings 里设置：

```text
COSMOS_ENDPOINT=https://<account>.documents.azure.com:443/
COSMOS_DATABASE=gymcheckin
COSMOS_CONTAINER=items
```

没有 `COSMOS_ENDPOINT` 时，API 会回退到本地 JSON 文件。Azure 生产环境一定要配置 Cosmos DB，因为 Functions 文件系统不适合持久保存数据。

Function App CORS 需要允许：

```text
https://gym.zy8095.io
https://stzygymzy8095.z5.web.core.windows.net
http://127.0.0.1:5174
```

并且生产环境为了 Microsoft 登录 cookie 需要启用 CORS credentials。Function App 生产环境设置 `AUTH_REQUIRED=true`，未登录时数据 API 会返回 401。

Azure 资源脚本在 [infra/azure-create.sh](/Users/zy8095/Documents/Codex/2026-04-23/chat/zyGym/infra/azure-create.sh:1)，它会创建 Storage Static Website、Function App、Cosmos DB serverless，并用 Function App 的 managed identity 授权 Cosmos。

部署 API 时需要远端 build，确保 `@azure/cosmos` 和 `@azure/identity` 被安装：

```bash
az functionapp deployment source config-zip \
  -g zyGym \
  -n func-zygym-zy8095 \
  --src .deploy/api.zip \
  --build-remote true
```

## 后续可加

- Microsoft Entra ID 登录，只允许自己访问
- 体重 / 体脂趋势记录
- 自动 deload 建议
- Azure Application Insights
- iPhone 主屏幕安装提示

## 参考

- [Azure Cosmos DB serverless](https://learn.microsoft.com/en-us/azure/cosmos-db/serverless)
- [Azure Static Web Apps database connections retirement notice](https://learn.microsoft.com/en-us/azure/static-web-apps/database-overview)
