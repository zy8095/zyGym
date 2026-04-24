# Azure Infra

This folder contains the resource creation script for the Azure version of Gym Check-in.

The app uses:

- Azure Storage Static Website for the frontend.
- Azure Functions for `/api`.
- Azure Cosmos DB for NoSQL, serverless capacity.
- Cloudflare DNS + Worker route for `https://gym.zy8095.io`.
- One Cosmos container named `items` with partition key `/userId`.
- Document `type` values: `session`, `plan`, `settings`.
- Function App system-assigned managed identity with Cosmos DB data-plane RBAC.

Why not Static Web Apps managed functions: managed functions do not support managed identity. This app keeps the frontend as static files and calls an independent Function App that can use MI.

## Create Resources

Do not run this until you are ready to create Azure resources.

```bash
cd /Users/zy8095/Documents/Codex/2026-04-23/chat/zyGym
chmod +x infra/azure-create.sh
./infra/azure-create.sh zyGym westus2 stzygymzy8095 func-zygym-zy8095 cosmos-zygym-zy8095
```

Resource names need to be globally unique where Azure requires it, especially the Cosmos DB account, Function App, and Storage account names. Storage account names must be lowercase letters and numbers.

## Deploy Code

After resources exist, deploy the frontend and API separately:

- Frontend: deploy `web/` to the storage account `$web` container. Use `web/config.json` to point at the Function App origin.
- API: zip `api/` and deploy it to the Function App with remote build enabled.

Example:

```bash
rm -rf .deploy
mkdir -p .deploy/api .deploy/web
rsync -a --exclude node_modules api/ .deploy/api/
(cd .deploy/api && zip -qr ../api.zip .)
rsync -a web/ .deploy/web/

az functionapp deployment source config-zip \
  -g zyGym \
  -n func-zygym-zy8095 \
  --src .deploy/api.zip \
  --build-remote true

az storage blob upload-batch \
  --account-name stzygymzy8095 \
  -s .deploy/web \
  -d '$web' \
  --overwrite
```

The script writes these Function App settings:

```text
COSMOS_ENDPOINT
COSMOS_DATABASE
COSMOS_CONTAINER
```

No Cosmos key or connection string is stored. The Function App uses `DefaultAzureCredential`, which resolves to its system-assigned managed identity in Azure.

## Cloudflare Domain

`gym.zy8095.io` uses a proxied CNAME to the Azure Storage static website origin plus a Worker route:

```text
DNS:    gym.zy8095.io CNAME stzygymzy8095.z5.web.core.windows.net, proxied
Route:  gym.zy8095.io/* -> zygym-front-proxy
Worker: infra/cloudflare-worker.js
```

The Worker rewrites the upstream host to `stzygymzy8095.z5.web.core.windows.net`. This is needed because Azure Storage static website returns 400 when it receives the custom hostname directly.

## Runtime Note

The deployed Function App is currently on Node 20 because Node 24 returned 503 during the first deployment test in `westus2`. Re-test Node 24 before changing `--runtime-version`.

## Cost Notes

Cosmos DB serverless bills by consumed RUs and storage. Storage Static Website and Azure Functions Consumption should stay tiny for this personal app, but check your subscription policy and quota.
