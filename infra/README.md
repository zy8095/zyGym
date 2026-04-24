# Azure Infra

This folder contains the resource creation script for the Azure version of Gym Check-in.

The app uses:

- Azure Static Web Apps Standard for the frontend.
- Bring Your Own Azure Functions for `/api`.
- Azure Cosmos DB for NoSQL, serverless capacity.
- One Cosmos container named `items` with partition key `/userId`.
- Document `type` values: `session`, `plan`, `settings`.
- Function App system-assigned managed identity with Cosmos DB data-plane RBAC.

Why Bring Your Own Functions: Static Web Apps managed functions do not support managed identity. The linked Function App does, and Static Web Apps Standard can proxy `/api` to it.

## Create Resources

Do not run this until you are ready to create Azure resources.

```bash
cd /Users/zy8095/Documents/Codex/2026-04-23/chat/gym-checkin-app
chmod +x infra/azure-create.sh
./infra/azure-create.sh rg-gym-checkin westus3 swa-gym-checkin func-gym-checkin stgymcheckinzy cosmos-gym-checkin-zy
```

Resource names need to be globally unique where Azure requires it, especially the Cosmos DB account, Function App, Static Web App, and Storage account names. Storage account names must be lowercase letters and numbers.

## Deploy Code

After resources exist, deploy the frontend and API separately:

- Frontend: deploy `web/` to Azure Static Web Apps.
- API: deploy `api/` to the linked Azure Functions app.

The Azure portal settings should match:

| Setting | Value |
|---|---|
| App location | `web` |
| API location | empty, because `/api` is linked to Bring Your Own Functions |
| Output location | empty |

The script writes these Function App settings:

```text
COSMOS_ENDPOINT
COSMOS_DATABASE
COSMOS_CONTAINER
```

No Cosmos key or connection string is stored. The Function App uses `DefaultAzureCredential`, which resolves to its system-assigned managed identity in Azure.

## Cost Notes

Cosmos DB serverless bills by consumed RUs and storage. Static Web Apps Free is usually enough for this personal app, but check your subscription policy and quota.
