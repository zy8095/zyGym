#!/usr/bin/env bash
set -euo pipefail

# Managed Identity architecture:
# - Static Web Apps Standard for frontend.
# - Bring Your Own Azure Functions for /api because SWA managed functions do not support MI.
# - Function App system-assigned managed identity gets Cosmos DB data-plane RBAC.
#
# Usage:
#   ./infra/azure-create.sh <resource-group> <region> <static-web-app-name> <function-app-name> <storage-account-name> <cosmos-account-name>
#
# Example:
#   ./infra/azure-create.sh rg-gym-checkin westus3 swa-gym-checkin func-gym-checkin stgymcheckinzy cosmos-gym-checkin-zy

RESOURCE_GROUP="${1:?resource group is required}"
LOCATION="${2:?location is required}"
STATIC_WEB_APP_NAME="${3:?static web app name is required}"
FUNCTION_APP_NAME="${4:?function app name is required}"
STORAGE_ACCOUNT_NAME="${5:?storage account name is required}"
COSMOS_ACCOUNT_NAME="${6:?cosmos account name is required}"

DATABASE_NAME="${COSMOS_DATABASE:-gymcheckin}"
CONTAINER_NAME="${COSMOS_CONTAINER:-items}"

az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION"

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

az storage account create \
  --name "$STORAGE_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2

az functionapp create \
  --name "$FUNCTION_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --storage-account "$STORAGE_ACCOUNT_NAME" \
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

az cosmosdb sql role assignment create \
  --account-name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --scope "/" \
  --principal-id "$PRINCIPAL_ID" \
  --role-definition-id "$ROLE_DEFINITION_ID"

az functionapp config appsettings set \
  --name "$FUNCTION_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    COSMOS_ENDPOINT="$COSMOS_ENDPOINT" \
    COSMOS_DATABASE="$DATABASE_NAME" \
    COSMOS_CONTAINER="$CONTAINER_NAME"

az staticwebapp create \
  --name "$STATIC_WEB_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard

FUNCTION_RESOURCE_ID="$(az functionapp show \
  --name "$FUNCTION_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query id \
  --output tsv)"

az staticwebapp functions link \
  --name "$STATIC_WEB_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --function-resource-id "$FUNCTION_RESOURCE_ID"

echo "Created resources:"
echo "  Resource group: $RESOURCE_GROUP"
echo "  Static Web App: $STATIC_WEB_APP_NAME"
echo "  Function App: $FUNCTION_APP_NAME"
echo "  Function principalId: $PRINCIPAL_ID"
echo "  Cosmos account: $COSMOS_ACCOUNT_NAME"
echo "  Database: $DATABASE_NAME"
echo "  Container: $CONTAINER_NAME"
echo "  Auth: Function App system-assigned managed identity + Cosmos DB data-plane RBAC"
