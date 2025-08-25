FROM node:18-alpine

WORKDIR /app/server

# Copiar archivos del servidor
COPY server/package*.json ./
COPY server/ ./

# Instalar dependencias
RUN npm install --production

# Generar cliente de Prisma
RUN npx prisma generate

# Exponer puerto
EXPOSE 5000

# Comando de inicio
CMD ["npm", "start"]
