# Gym Check-in

手机优先的训练打卡 PWA。前端是静态网页，后端是 `/api`，本地开发使用 JSON 文件数据库，Azure 生产环境使用 Cosmos DB serverless。

## 本地运行

```bash
cd gym-checkin-app
node tools/dev-server.mjs
```

打开 `http://localhost:5174`。

如果你的 shell 里有 `npm`，也可以用 `npm run dev`；当前第一版本地运行不需要安装依赖。

本地记录会写到：

```text
gym-checkin-app/data/gym-checkin.local.json
```

## 当前功能

- 今日训练自动显示：推 / 腿 / 拉 / Zone 2 / 普拉提 / 休息
- 训练动作 guide：器械名、照片编号、组数次数、动作重点
- 每组记录：重量、次数、RIR、完成状态
- 低疲劳模式：保留主项，减少补量组
- 根据上次记录提示：先补次数或下次加一档
- 历史记录
- JSON / CSV 导出
- PWA 离线缓存

## Azure 架构

推荐：

```text
Azure Static Web Apps Standard
  web/ 静态前端

Bring Your Own Azure Functions
  api/ Functions backend
  system-assigned managed identity

Azure Cosmos DB for NoSQL
  serverless account
  database: gymcheckin
  container: items
  partition key: /userId
```

不用 Azure Static Web Apps database connections。Microsoft Learn 上这个功能已经有退役通知，结束日期是 2025-11-30；这个项目直接用 Functions API 访问数据库。

不用 Cosmos key / connection string。Static Web Apps 的 managed functions 不支持 managed identity，所以生产环境用 Static Web Apps Standard + Bring Your Own Functions。Functions App 开系统托管身份，然后给它 Cosmos DB data-plane RBAC 的 `Cosmos DB Built-in Data Contributor`。

## Azure 配置

在 Azure Static Web Apps 创建项目时：

| 设置 | 值 |
|---|---|
| App location | `gym-checkin-app/web` |
| API location | 留空，使用 linked Function App |
| Output location | 留空 |

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

Azure 资源脚本在 [infra/azure-create.sh](/Users/zy8095/Documents/Codex/2026-04-23/chat/gym-checkin-app/infra/azure-create.sh:1)，它会创建 Static Web Apps Standard、Function App、Cosmos DB serverless，并用 Function App 的 managed identity 授权 Cosmos。

## 后续可加

- Microsoft Entra ID 登录，只允许自己访问
- 体重 / 体脂趋势记录
- 训练动作替换菜单
- 自动 deload 建议
- Azure Application Insights
- iPhone 主屏幕安装提示

## 参考

- [Azure Static Web Apps API support with Azure Functions](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-functions)
- [Bring your own functions to Azure Static Web Apps](https://learn.microsoft.com/en-us/azure/static-web-apps/functions-bring-your-own)
- [Azure Cosmos DB serverless](https://learn.microsoft.com/en-us/azure/cosmos-db/serverless)
- [Azure Static Web Apps database connections retirement notice](https://learn.microsoft.com/en-us/azure/static-web-apps/database-overview)
