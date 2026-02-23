#!/bin/bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;36m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
PROJECT_NAME="fractalis"
COMPONENT="backend"
REGION="us-central1"
REPOSITORY="proyectos-desarrollo"

VERSION=${1:-"latest"}

if [ "$VERSION" == "latest" ]; then
  echo -e "${RED}⚠️  WARNING: Using 'latest' tag is not recommended for production${NC}"
  echo -e "${BLUE}💡 Usage: ./build-and-push.sh v1.0.0${NC}"
  read -p "Continue with 'latest'? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

IMAGE_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${PROJECT_NAME}/${COMPONENT}"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🔨 Building ${PROJECT_NAME}/${COMPONENT}:${VERSION}${NC}"
echo -e "${BLUE}📦 Project: ${PROJECT_ID}${NC}"
echo -e "${BLUE}🌎 Region: ${REGION}${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

echo -e "\n${GREEN}🏗️  Building Backend (no cache)...${NC}"
docker build --no-cache \
  -t ${IMAGE_URL}:${VERSION} \
  -t ${IMAGE_URL}:latest \
  .

echo -e "\n${GREEN}📤 Pushing to Artifact Registry...${NC}"
docker push ${IMAGE_URL}:${VERSION}
docker push ${IMAGE_URL}:latest

echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Backend image pushed successfully!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Subir migraciones SQL a la VM
echo -e "\n${YELLOW}📤 Upload migrations to VM?${NC}"
read -p "Upload database/migrations to fractalis-vm? (Y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
  VM_NAME="fractalis-vm"
  VM_ZONE="us-central1-a"
  VM_PATH="/opt/proyectos/fractalis"

  if [ ! -d "./database/migrations" ]; then
    echo -e "${RED}❌ Error: ./database/migrations directory not found${NC}"
    exit 1
  fi

  echo -e "\n${GREEN}📤 Uploading migrations to VM...${NC}"

  # Crear directorio en la VM si no existe
  gcloud compute ssh ${VM_NAME} --zone=${VM_ZONE} \
    --command="sudo mkdir -p ${VM_PATH}/database/migrations && sudo chown -R \$USER:\$USER /opt/proyectos"

  # Subir migrations de Flyway
  gcloud compute scp --recurse \
    ./database/migrations \
    ${VM_NAME}:${VM_PATH}/database/ \
    --zone=${VM_ZONE}

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Migrations uploaded successfully!${NC}"
  else
    echo -e "${RED}⚠️  Warning: Failed to upload migrations. Upload manually.${NC}"
  fi
fi

echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🏷️  Version: ${VERSION}${NC}"
echo -e "${GREEN}Image URL:${NC}"
echo -e "  ${IMAGE_URL}:${VERSION}"
echo -e ""
echo -e "${YELLOW}📝 Next steps:${NC}"
echo -e "  1. SSH to VM: ${BLUE}gcloud compute ssh fractalis-vm --zone=us-central1-a${NC}"
echo -e "  2. Deploy:    ${BLUE}cd /opt/proyectos/fractalis && docker compose pull && docker compose up -d${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
