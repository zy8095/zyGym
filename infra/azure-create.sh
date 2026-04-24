#!/usr/bin/env bash
set -euo pipefail

# Managed Identity architecture:
# - Azure Storage Static Website for frontend.
# - Azure Functions for /api.
# - Function App system-assigned managed identity gets Cosmos DB data-plane RBAC.
#
# Usage:
#   ./infra/azure-create.sh <resource-group> <region> <web-storage-account-name> <function-app-name> <cosmos-account-name>
#
# Example:
#   ./infra/azure-create.sh zyGym westus2 stzygymzy8095 func-zygym-zy8095 cosmos-zygym-zy8095

RESOURCE_GROUP="${1:?resource group is required}"
LOCATION="${2:?location is required}"
WEB_STORAGE_ACCOUNT_NAME="${3:?web storage account name is required}"
FUNCTION_APP_NAME="${4:?function app name is required}"
COSMOS_ACCOUNT_NAME="${5:?cosmos account name is required}"

DATABASE_NAME="${COSMOS_DATABASE:-gymcheckin}"
CONTAINER_NAME="${COSMOS_CONTAINER:-items}"

az provider register --namespace Microsoft.DocumentDB --wait
az provider register --namespace Microsoft.Web --wait
az provider register --namespace Microsoft.Storage --wait

az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION"

az storage account create \
  --name "$WEB_STORAGE_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --allow-blob-public-access true

az storage blob service-properties update \
  --account-name "$WEB_STORAGE_ACCOUNT_NAME" \
  --static-website \
  --index-document index.html \
  --404-document index.html

az cosmosdb create \
  --name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --locations regionName="$LOCATION" failoverPriority=0 isZoneRedundant=False \
  --capabilities EnableServerless \
  --default-consistency-level Session

az cosmosdb sql database create \
  --account-name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --name "$DATABASE_NAME"

az cosmosdb sql container create \
  --account-name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --database-name "$DATABASE_NAME" \
  --name "$CONTAINER_NAME" \
  --partition-key-path "/userId"

az functionapp create \
  --name "$FUNCTION_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --storage-account "$WEB_STORAGE_ACCOUNT_NAME" \
  --consumption-plan-location "$LOCATION" \
  --functions-version 4 \
  --runtime node \
  --runtime-version 20 \
  --os-type Linux

az functionapp identity assign \
  --name "$FUNCTION_APP_NAME" \
  --resource-group "$RESOURCE_GROUP"

PRINCIPAL_ID="$(az functionapp identity show \
  --name "$FUNCTION_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query principalId \
  --output tsv)"

COSMOS_ENDPOINT="$(az cosmosdb show \
  --name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query documentEndpoint \
  --output tsv)"

ROLE_DEFINITION_ID="$(az cosmosdb sql role definition list \
  --account-name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[?roleName=='Cosmos DB Built-in Data Contributor'].id | [0]" \
  --output tsv)"

ASSIGNMENT_COUNT="$(az cosmosdb sql role assignment list \
  --account-name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[?principalId=='$PRINCIPAL_ID' && roleDefinitionId=='$ROLE_DEFINITION_ID'] | length(@)" \
  --output tsv)"

if [[ "$ASSIGNMENT_COUNT" == "0" ]]; then
  az cosmosdb sql role assignment create \
    --account-name "$COSMOS_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --scope "/" \
    --principal-id "$PRINCIPAL_ID" \
    --role-definition-id "$ROLE_DEFINITION_ID"
fi

az functionapp config appsettings set \
  --name "$FUNCTION_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    COSMOS_ENDPOINT="$COSMOS_ENDPOINT" \
    COSMOS_DATABASE="$DATABASE_NAME" \
    COSMOS_CONTAINER="$CONTAINER_NAME"

WEB_URL="$(az storage account show \
  --name "$WEB_STORAGE_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query primaryEndpoints.web \
  --output tsv)"

az functionapp cors add \
  --name "$FUNCTION_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --allowed-origins "${WEB_URL%/}"

echo "Created resources:"
echo "  Resource group: $RESOURCE_GROUP"
echo "  Frontend: $WEB_URL"
echo "  Function App: https://$FUNCTION_APP_NAME.azurewebsites.net"
echo "  Function principalId: $PRINCIPAL_ID"
echo "  Cosmos account: $COSMOS_ACCOUNT_NAME"
echo "  Database: $DATABASE_NAME"
echo "  Container: $CONTAINER_NAME"
echo "  Auth: Function App system-assigned managed identity + Cosmos DB data-plane RBAC"
